// Effects do not run unless a test opts in (setEffectRunner), so existing tests
// keep seeing first-render output only.
let effectRunner = null
export function setEffectRunner(runner) {
  effectRunner = runner
}
export const useEffect = (effect, deps) => {
  if (effectRunner) effectRunner(effect, deps)
}
export const useRef = value => ({ current: value })
export const useState = initial => [typeof initial === 'function' ? initial() : initial, () => {}]
