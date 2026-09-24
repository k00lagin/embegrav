import { useEffect } from 'react'
import { useToast } from '@/components/Toast'

/** Keep a load error and its retry action scoped to the current view. */
export function useErrorToast(error: string | null, title: string, retry: () => void) {
  const toast = useToast()
  useEffect(() => {
    if (error === null) return
    const id = toast.show('error', title, error, undefined, { label: 'Retry', onClick: retry })
    return () => toast.dismiss(id)
  }, [error, title, retry, toast])
}
