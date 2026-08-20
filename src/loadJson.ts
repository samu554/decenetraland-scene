export async function loadJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`loadJson: ${res.status} ${res.statusText} per ${url}`)
  return (await res.json()) as T
}