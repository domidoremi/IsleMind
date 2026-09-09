import { createLazyComponent } from '@/utils/lazyLoad'

export default createLazyComponent(async () => {
  const [{ default: DocumentEditorScreen }, { documentLibrary }, { documentRevision }] = await Promise.all([
    import('@/presentation/features/documents/DocumentEditorScreen'),
    import('@/bootstrap/documentLibrary'),
    import('@/bootstrap/documentRevision'),
  ])
  return { default: () => <DocumentEditorScreen repository={documentLibrary} revision={documentRevision} /> }
})
