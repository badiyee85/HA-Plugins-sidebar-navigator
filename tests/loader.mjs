const stubs = new Map([
  ['@hermes/plugin-sdk', new URL('./sdk-stub.mjs', import.meta.url).href],
  ['react', new URL('./react-stub.mjs', import.meta.url).href],
  ['react/jsx-runtime', new URL('./jsx-runtime-stub.mjs', import.meta.url).href]
])

export async function resolve(specifier, context, nextResolve) {
  const url = stubs.get(specifier)
  return url ? { url, shortCircuit: true } : nextResolve(specifier, context)
}
