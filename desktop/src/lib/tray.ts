import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef } from 'react'
import { m } from '~/paraglide/messages.js'

export function useTray(enabled: boolean, locale: string, recording: boolean) {
	const pending = useRef<Promise<void>>(Promise.resolve())
	useEffect(() => {
		const labels = { show: m.trayShow(), hide: m.trayHide(), quit: m.trayQuit(), stop: m.stopRecording() }
		pending.current = pending.current.then(() => invoke<void>('set_tray', { enabled, recording, labels }))
			.catch((error) => console.error('failed to update the tray:', error))
	}, [enabled, locale, recording])
}
