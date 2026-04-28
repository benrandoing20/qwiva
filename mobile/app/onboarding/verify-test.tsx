import { View, Text, TextInput, StyleSheet } from 'react-native';

export default function VerifyTest() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Test Input</Text>
      <TextInput
        style={styles.input}
        placeholder="Type here"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 100 },
  label: { fontSize: 14, marginBottom: 8 },
  input: {
    height: 52,
    borderWidth: 1.5,
    borderColor: '#E2E2EC',
    borderRadius: 10,
    paddingHorizontal: 16,
    fontSize: 15,
  },
});
