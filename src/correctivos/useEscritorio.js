import { useEffect, useState } from 'react'

// true en pantallas de escritorio (>= 900 px)
export function useEscritorio() {
  const q = '(min-width: 900px)'
  const [es, setEs] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const fn = (e) => setEs(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return es
}
