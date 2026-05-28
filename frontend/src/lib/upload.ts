import { filesApi } from '../api/client'

export async function uploadFile(
  file: File,
  clientId?: string,
  description?: string,
): Promise<{ fileId: string; name: string }> {
  const { file_id, upload_url } = await filesApi.uploadUrl({
    filename: file.name,
    content_type: file.type || 'application/octet-stream',
    client_id: clientId,
    description,
  })

  const upload = await fetch(upload_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  })
  if (!upload.ok) {
    throw new Error(`Upload failed with status ${upload.status}`)
  }

  await filesApi.uploadComplete({
    file_id,
    size_bytes: file.size,
  })

  return { fileId: file_id, name: file.name }
}
