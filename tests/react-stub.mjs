export const useEffect = () => {}
export const useRef = value => ({ current: value })
export const useState = initial => [typeof initial === 'function' ? initial() : initial, () => {}]
