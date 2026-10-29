import { forwardRef } from 'react'
import { Modal as NativeModal, type ModalProps } from 'react-native'
import { useAppUpdateBlocker } from '@/hooks/useAppUpdateBlocker'

/** Keep native/editor overlays out of automatic update prompt boundaries. */
export const Modal = forwardRef<NativeModal, ModalProps>(function AppModal(props, ref) {
  useAppUpdateBlocker(props.visible !== false, 'modal')
  return <NativeModal {...props} ref={ref} />
})
