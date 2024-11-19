export interface ChangedFile {
  filePath: string
  url: string
  lines: number[]
  prUrl?: string
}
