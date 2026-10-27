// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { RecordingShortcutProvider, useRecordingShortcut } from './recording-shortcut'

const native = vi.hoisted(() => ({
	listeners: new Map<string, (event: { payload: unknown }) => void>(),
	shortcut: undefined as ((event: { state: string }) => void) | undefined,
	invoke: vi.fn(),
	emit: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
	emit: native.emit,
	listen: vi.fn(async (event: string, listener: (event: { payload: unknown }) => void) => {
		native.listeners.set(event, listener)
		return () => native.listeners.delete(event)
	}),
}))
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
	isRegistered: vi.fn(async () => false),
	register: vi.fn(async (_shortcut: string, callback: typeof native.shortcut) => { native.shortcut = callback }),
	unregister: vi.fn(async () => {}),
}))
vi.mock('~/lib/config-store', () => ({
	usePersisted: (_key: string, fallback: unknown) => [typeof fallback === 'boolean' ? true : fallback, vi.fn()],
}))
vi.mock('./hotkey', () => ({ useHotkeyProvider: () => ({ isHotkeyRecording: false }) }))

function Controls({ mounted }: { mounted: boolean }) {
	const recording = useRecordingShortcut()
	return <>
		{mounted && <ManualSession />}
		<span>{recording.isRecording ? 'recording' : 'idle'}</span>
		<button onClick={() => void recording.stopRecording()}>Stop</button>
	</>
}

function ManualSession() {
	const { setNormalRecordingActive } = useRecordingShortcut()
	useEffect(() => () => setNormalRecordingActive(false), [setNormalRecordingActive])
	return null
}

beforeEach(() => {
	native.listeners.clear()
	native.shortcut = undefined
	native.invoke.mockReset().mockImplementation(async (command: string) =>
		command === 'get_audio_devices' ? [{ id: '1', isDefault: true, isInput: true }] : undefined,
	)
	native.emit.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('recording shortcut controls', () => {
	it('keeps a shortcut recording stoppable when manual session state is cleared, and resets on finish', async () => {
		const view = render(<RecordingShortcutProvider><Controls mounted /></RecordingShortcutProvider>)
		await waitFor(() => expect(native.shortcut).toBeDefined())
		await act(async () => { native.shortcut?.({ state: 'Pressed' }) })
		await screen.findByText('recording')
		view.rerender(<RecordingShortcutProvider><Controls mounted={false} /></RecordingShortcutProvider>)
		fireEvent.click(screen.getByText('Stop'))
		await waitFor(() => expect(native.emit).toHaveBeenCalledWith('stop_record'))
		act(() => native.listeners.get('record_finish')?.({ payload: null }))
		expect(screen.getByText('idle')).toBeTruthy()
	})

	it('does not stop before the recording backend finishes starting', async () => {
		let finishStart!: () => void
		native.invoke.mockImplementation((command: string) => {
			if (command === 'get_audio_devices') return Promise.resolve([{ id: '1', isDefault: true, isInput: true }])
			if (command === 'start_record') return new Promise<void>((resolve) => { finishStart = resolve })
			return Promise.resolve()
		})
		render(<RecordingShortcutProvider><Controls mounted={false} /></RecordingShortcutProvider>)
		await waitFor(() => expect(native.shortcut).toBeDefined())
		act(() => native.shortcut?.({ state: 'Pressed' }))
		await waitFor(() => expect(finishStart).toBeDefined())
		fireEvent.click(screen.getByText('Stop'))
		expect(native.emit).not.toHaveBeenCalledWith('stop_record')
		await act(async () => finishStart())
		await screen.findByText('recording')
		fireEvent.click(screen.getByText('Stop'))
		await waitFor(() => expect(native.emit).toHaveBeenCalledWith('stop_record'))
	})

	it('routes the tray stop action through the same guarded stop and resets on error', async () => {
		render(<RecordingShortcutProvider><Controls mounted={false} /></RecordingShortcutProvider>)
		await waitFor(() => expect(native.shortcut).toBeDefined())
		await act(async () => { native.shortcut?.({ state: 'Pressed' }) })
		await screen.findByText('recording')
		await act(async () => native.listeners.get('tray-stop-recording')?.({ payload: null }))
		await waitFor(() => expect(native.emit).toHaveBeenCalledWith('stop_record'))
		act(() => native.listeners.get('record_error')?.({ payload: null }))
		expect(screen.getByText('idle')).toBeTruthy()
	})
})
