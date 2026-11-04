/**
 * Runs extractSections in a plain Node process. PDF.js uses a dynamic import
 * that Jest's sandbox can't execute, so the PDF tests call this instead (which
 * is also closer to how the server runs). Reads base64 from stdin; prints JSON.
 */
import { extractSections } from '@/server/ai/extract'

async function main() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const bytes = new Uint8Array(Buffer.from(Buffer.concat(chunks).toString(), 'base64'))
  try {
    const sections = await extractSections(bytes, process.argv[2])
    process.stdout.write(JSON.stringify({ sections }))
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: (error as Error).name, message: (error as Error).message }))
  }
}

void main()
