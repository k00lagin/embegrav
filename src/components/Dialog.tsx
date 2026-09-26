import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { FieldValues } from './dialogValues'

export type Field =
  | {
      type: 'text'
      name: string
      label: string
      default?: string
      placeholder?: string
      mono?: boolean
    }
  | {
      type: 'textarea'
      name: string
      label: string
      default?: string
      placeholder?: string
      rows?: number
    }
  | { type: 'checkbox'; name: string; label: string; default?: boolean; description?: string }
  | {
      type: 'select'
      name: string
      label: string
      options: { value: string; label: string }[]
      default?: string
    }
  | {
      type: 'radio'
      name: string
      label: string
      options: { value: string; label: string; description?: string }[]
      default?: string
    }
  | { type: 'info'; name: string; text: string }

export type { FieldValues } from './dialogValues'

export interface DialogSpec {
  title: string
  description?: ReactNode
  fields?: Field[]
  submitLabel?: string
  cancelLabel?: string
  danger?: boolean
  /** Return an error string to keep the dialog open */
  validate?: (values: FieldValues) => string | null
}

interface DialogApi {
  open: (spec: DialogSpec) => Promise<FieldValues | null>
  confirm: (
    title: string,
    description?: ReactNode,
    opts?: { submitLabel?: string; danger?: boolean },
  ) => Promise<boolean>
  prompt: (
    title: string,
    label: string,
    defaultValue?: string,
    opts?: { submitLabel?: string; placeholder?: string },
  ) => Promise<string | null>
}

const DialogContext = createContext<DialogApi | null>(null)

export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('useDialog must be used within DialogProvider')
  return ctx
}

interface Active {
  id: number
  spec: DialogSpec
  resolve: (v: FieldValues | null) => void
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Active | null>(null)
  const seq = useRef(0)

  const open = useCallback((spec: DialogSpec) => {
    const names = new Set<string>()
    for (const field of spec.fields ?? []) {
      if (names.has(field.name)) throw new Error(`Duplicate dialog field: ${field.name}`)
      names.add(field.name)
    }
    return new Promise<FieldValues | null>((resolve) => {
      const id = ++seq.current
      setActive((prev) => {
        prev?.resolve(null)
        return { id, spec, resolve }
      })
    })
  }, [])

  const api = useMemo<DialogApi>(
    () => ({
      open,
      confirm: async (title, description, opts) => {
        const r = await open({
          title,
          description,
          submitLabel: opts?.submitLabel ?? 'Yes',
          cancelLabel: 'No',
          danger: opts?.danger,
        })
        return r !== null
      },
      prompt: async (title, label, defaultValue = '', opts) => {
        const r = await open({
          title,
          fields: [
            {
              type: 'text',
              name: 'value',
              label,
              default: defaultValue,
              placeholder: opts?.placeholder,
            },
          ],
          submitLabel: opts?.submitLabel ?? 'OK',
        })
        return r ? String(r.value) : null
      },
    }),
    [open],
  )

  const close = useCallback((values: FieldValues | null) => {
    setActive((prev) => {
      prev?.resolve(values)
      return null
    })
  }, [])

  return (
    <DialogContext.Provider value={api}>
      {children}
      {active && <DialogView key={active.id} spec={active.spec} onClose={close} />}
    </DialogContext.Provider>
  )
}

function initialValues(fields: Field[] | undefined): FieldValues {
  const v: FieldValues = {}
  for (const f of fields ?? []) {
    if (f.type === 'checkbox') v[f.name] = f.default ?? false
    else if (f.type === 'info') continue
    else
      v[f.name] =
        f.default ?? (f.type === 'select' || f.type === 'radio' ? (f.options[0]?.value ?? '') : '')
  }
  return v
}

function DialogView({
  spec,
  onClose,
}: {
  spec: DialogSpec
  onClose: (v: FieldValues | null) => void
}) {
  const [values, setValues] = useState<FieldValues>(() => initialValues(spec.fields))
  const [error, setError] = useState<string | null>(null)
  const firstField = (spec.fields ?? []).find((f) => f.type !== 'info')?.name

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    const err = spec.validate?.(values) ?? null
    if (err) {
      setError(err)
      return
    }
    onClose(values)
  }

  const set = (name: string, value: string | boolean) => setValues((v) => ({ ...v, [name]: value }))

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/50 pt-[12vh]"
      onMouseDown={() => onClose(null)}
    >
      <form
        className="modal w-[460px] max-w-[92vw] max-h-[80vh] overflow-y-auto"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="px-4 py-3 border-b border-border font-semibold">{spec.title}</div>
        <div className="px-4 py-3 flex flex-col gap-3">
          {spec.description && (
            <div className="text-fg-muted whitespace-pre-wrap break-words">{spec.description}</div>
          )}
          {(spec.fields ?? []).map((f) => {
            switch (f.type) {
              case 'text':
                return (
                  <label key={f.name} className="flex flex-col gap-1">
                    <span className="text-fg-muted">{f.label}</span>
                    <input
                      autoFocus={f.name === firstField}
                      type="text"
                      className={f.mono ? 'mono' : ''}
                      value={String(values[f.name] ?? '')}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.name, e.target.value)}
                      spellCheck={false}
                    />
                  </label>
                )
              case 'textarea':
                return (
                  <label key={f.name} className="flex flex-col gap-1">
                    <span className="text-fg-muted">{f.label}</span>
                    <textarea
                      autoFocus={f.name === firstField}
                      rows={f.rows ?? 4}
                      value={String(values[f.name] ?? '')}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                  </label>
                )
              case 'checkbox':
                return (
                  <label key={f.name} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={Boolean(values[f.name])}
                      onChange={(e) => set(f.name, e.target.checked)}
                    />
                    <span>
                      {f.label}
                      {f.description && <div className="text-fg-dim text-xs">{f.description}</div>}
                    </span>
                  </label>
                )
              case 'select':
                return (
                  <label key={f.name} className="flex flex-col gap-1">
                    <span className="text-fg-muted">{f.label}</span>
                    <select
                      value={String(values[f.name] ?? '')}
                      onChange={(e) => set(f.name, e.target.value)}
                    >
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              case 'radio':
                return (
                  <fieldset key={f.name} className="flex flex-col gap-1">
                    <legend className="text-fg-muted mb-1">{f.label}</legend>
                    {f.options.map((o) => (
                      <label key={o.value} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="radio"
                          className="mt-1"
                          name={f.name}
                          checked={values[f.name] === o.value}
                          onChange={() => set(f.name, o.value)}
                        />
                        <span>
                          {o.label}
                          {o.description && (
                            <div className="text-fg-dim text-xs">{o.description}</div>
                          )}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )
              case 'info':
                return (
                  <div key={f.name} className="text-fg-muted text-xs whitespace-pre-wrap">
                    {f.text}
                  </div>
                )
            }
          })}
          {error && <div className="text-danger">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => onClose(null)}>
            {spec.cancelLabel ?? 'Cancel'}
          </button>
          <button
            autoFocus={!firstField}
            type="submit"
            className={`btn ${spec.danger ? 'btn-danger' : ''}`}
          >
            {spec.submitLabel ?? 'OK'}
          </button>
        </div>
      </form>
    </div>
  )
}
