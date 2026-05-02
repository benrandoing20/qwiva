// ChatContext owns the active conversation thread and the list of past
// conversations. AskContent renders the thread + input; Sidebar renders the
// list and dispatches loadConversation to switch threads. Lifting this state
// out of the Ask screen keeps both surfaces in sync without prop drilling.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  streamSearch,
  getAccessToken,
  fetchConversations,
  fetchConversationMessages,
  deleteConversation as apiDeleteConversation,
} from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { ChatMessage, Conversation } from '@/types';

export interface ProfileSnapshot {
  firstName: string | null;
  cadre: string | null;
}

export interface ChatContextValue {
  profile: ProfileSnapshot | null;

  // Active thread
  messages: ChatMessage[];
  conversationId: string | null;
  isStreaming: boolean;

  // Conversation list (sidebar)
  conversations: Conversation[];
  conversationsLoading: boolean;

  // Operations
  send: (query: string) => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  newChat: () => void;
  refreshConversations: () => Promise<void>;
  deleteConversationById: (id: string) => Promise<void>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  // Profile snapshot for greeting + suggestion filtering
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (mounted) setProfile({ firstName: null, cadre: null });
        return;
      }
      const { data } = await supabase
        .from('user_profiles')
        .select('first_name, cadre')
        .eq('user_id', user.id)
        .single();
      if (mounted) {
        setProfile({
          firstName: data?.first_name ?? null,
          cadre: data?.cadre ?? null,
        });
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshConversations = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        setConversations([]);
        return;
      }
      const list = await fetchConversations(token);
      setConversations(list);
    } catch {
      // Silent — sidebar will simply show an empty list. Network errors
      // shouldn't blow up the chat surface.
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  // Load the conversation list whenever a session exists.
  useEffect(() => {
    refreshConversations();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        refreshConversations();
      } else if (event === 'SIGNED_OUT') {
        setConversations([]);
        setMessages([]);
        setConversationId(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshConversations]);

  const send = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query || isStreaming) return;

      const userMsgId = `user-${Date.now()}`;
      const assistantMsgId = `assistant-${Date.now()}`;
      const userMessage: ChatMessage = {
        id: userMsgId,
        stableKey: userMsgId,
        role: 'user',
        content: query,
      };
      const assistantPlaceholder: ChatMessage = {
        id: assistantMsgId,
        stableKey: assistantMsgId,
        role: 'assistant',
        content: '',
        isStreaming: true,
        statusMessage: 'Searching guidelines…',
      };

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      setIsStreaming(true);

      const token = await getAccessToken();
      if (!token) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: 'You need to be signed in to ask questions.',
                  isStreaming: false,
                  isError: true,
                }
              : m,
          ),
        );
        setIsStreaming(false);
        return;
      }

      let newConversationId: string | null = null;

      try {
        for await (const evt of streamSearch(query, token, conversationId)) {
          if (evt.event === 'conversation') {
            if (!conversationId) {
              newConversationId = evt.data.conversation_id;
              setConversationId(evt.data.conversation_id);
            }
          } else if (evt.event === 'status') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, statusMessage: evt.data.message } : m,
              ),
            );
          } else if (evt.event === 'citations') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      citations: evt.data.citations,
                      evidence_grade: evt.data.evidence_grade,
                    }
                  : m,
              ),
            );
          } else if (evt.event === 'token') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + evt.data.token }
                  : m,
              ),
            );
          } else if (evt.event === 'done') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, isStreaming: false } : m,
              ),
            );
          } else if (evt.event === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: evt.data.detail,
                      isStreaming: false,
                      isError: true,
                    }
                  : m,
              ),
            );
          }
        }
      } catch (e: unknown) {
        const raw = e instanceof Error ? e.message : 'Something went wrong.';
        // Common network failures from expo/fetch don't carry a friendly
        // message — swap in something the user can act on.
        const lower = raw.toLowerCase();
        const isNetwork =
          lower.includes('network') ||
          lower.includes('failed to fetch') ||
          lower.includes('aborted') ||
          lower.includes('timed out') ||
          lower.includes('timeout');
        const detail = isNetwork
          ? "Couldn't reach the server. Check that the backend is running and EXPO_PUBLIC_API_URL points to a reachable host (your Mac's LAN IP, not localhost), and that uvicorn was started with --host 0.0.0.0."
          : raw;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: detail, isStreaming: false, isError: true }
              : m,
          ),
        );
      } finally {
        setIsStreaming(false);
        if (newConversationId) {
          // First message in a fresh thread — refresh the sidebar list so the
          // new conversation appears immediately.
          refreshConversations();
        }
      }
    },
    [conversationId, isStreaming, refreshConversations],
  );

  const loadConversation = useCallback(async (id: string) => {
    const token = await getAccessToken();
    if (!token) return;
    try {
      const msgs = await fetchConversationMessages(id, token);
      setMessages(
        msgs.map((m) => ({ ...m, stableKey: m.id })),
      );
      setConversationId(id);
    } catch {
      // Leave thread state unchanged on failure.
    }
  }, []);

  const newChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
  }, []);

  const deleteConversationById = useCallback(
    async (id: string) => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        await apiDeleteConversation(id, token);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (conversationId === id) {
          setMessages([]);
          setConversationId(null);
        }
      } catch {
        // Soft fail; the sidebar will still show the row.
      }
    },
    [conversationId],
  );

  const value: ChatContextValue = {
    profile,
    messages,
    conversationId,
    isStreaming,
    conversations,
    conversationsLoading,
    send,
    loadConversation,
    newChat,
    refreshConversations,
    deleteConversationById,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
