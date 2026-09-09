import { createLazyComponent } from '@/utils/lazyLoad'

export default createLazyComponent(async () => {
  const [{ default: DocumentLibraryScreen }, { documentLibrary }] = await Promise.all([
    import('@/presentation/features/documents/DocumentLibraryScreen'),
    import('@/bootstrap/documentLibrary'),
  ])
  return { default: () => <DocumentLibraryScreen repository={documentLibrary} /> }
})
