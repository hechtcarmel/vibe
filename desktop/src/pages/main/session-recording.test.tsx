// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { SessionProvider, useSession } from './session'

const test = vi.hoisted(() => ({
	listeners: new Map<string, (event: { payload: unknown }) => void>(),
	save: vi.fn(),
	hydrate: vi.fn(),
	setNormalRecordingActive: vi.fn(),
	setIsRecording: vi.fn(),
	dropEnabled: vi.fn(),
	invoke: vi.fn(async (command: string) => command === 'is_crashed_recently' ? false : '/models'),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: test.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
	test.listeners.set(name, callback)
	return () => test.listeners.delete(name)
}) }))
vi.mock('@tauri-apps/api', () => ({ webviewWindow: { getCurrentWebviewWindow: () => ({ show: vi.fn() }) } }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ message: vi.fn(), open: vi.fn() }))
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), error: vi.fn() } }))
vi.mock('~/lib/model', () => ({ cleanupPartialDownloads: vi.fn(), listInstalledModels: vi.fn(async () => []) }))
vi.mock('~/lib/fs', () => ({ pathToNamedPath: vi.fn() }))
vi.mock('~/lib/project-name', () => ({ autoProjectName: () => 'Test recording' }))
vi.mock('~/lib/transcripts-store', () => ({
	saveTranscript: test.save, notifyTranscriptsChanged: vi.fn(), TRANSCRIPT_VERSION: 1,
}))
vi.mock('~/lib/use-confirm-exit', () => ({ useConfirmExit: vi.fn() }))
vi.mock('~/providers/hotkey', () => ({ hotkeyRecordingActive: false }))
vi.mock('~/providers/recording-shortcut', () => ({ useRecordingShortcut: () => ({
	isShortcutRecording: false, setNormalRecordingActive: test.setNormalRecordingActive,
}) }))
vi.mock('~/providers/error-modal', async () => {
	const { createContext } = await import('react')
	return { ErrorModalContext: createContext({ setState: vi.fn() }) }
})
vi.mock('~/providers/preference', () => ({ usePreferenceProvider: () => ({
	advancedTranscribeOptions: {}, projectsPath: '/projects', modelOptions: { lang: 'en' }, modelPath: null,
	autoTranscribeAfterRecording: false, skippedSetup: true, closeToTray: false, setModelPath: vi.fn(),
}) }))
vi.mock('~/pages/home/hooks/use-recording', () => ({ useRecording: () => ({
	isRecording: true, isStarting: false, setIsRecording: test.setIsRecording,
}) }))
vi.mock('~/pages/home/hooks/use-audio-download', () => ({ useAudioDownload: () => ({}) }))
vi.mock('./hooks/use-drop-target', () => ({ useDropTarget: (_handler: unknown, enabled: boolean) => { test.dropEnabled(enabled); return false } }))
vi.mock('./hooks/use-summaries', () => ({ useSummaries: () => ({}) }))
vi.mock('./hooks/use-transcribe-queue', () => ({ useTranscribeQueue: () => ({
	enqueue: vi.fn(), hydrate: test.hydrate, transcribeJob: vi.fn(), reset: vi.fn(), jobs: [], running: false,
}) }))

function Main() {
	const navigate = useNavigate()
	const { recording } = useSession()
	return <><span>{recording.isRecording ? 'recording' : 'idle'}</span><button onClick={() => navigate('/setup')}>Setup</button></>
}

function Setup() {
	const navigate = useNavigate()
	return <button onClick={() => navigate('/')}>Back to main</button>
}

afterEach(() => { cleanup(); vi.clearAllMocks(); test.listeners.clear() })

describe('recording across setup', () => {
	it('keeps the recording active and saves its finished audio after navigating to setup', async () => {
		test.save.mockResolvedValue({ mediaPath: '/projects/audio.wav', recordPath: '/projects/transcript.vibe.json' })
		test.hydrate.mockReturnValue('job-1')
		render(<MemoryRouter><SessionProvider><Routes><Route path="/" element={<Main />} /><Route path="/setup" element={<span>Setup page</span>} /></Routes></SessionProvider></MemoryRouter>)
		await screen.findByText('recording')
		await waitFor(() => expect(test.listeners.has('record_finish')).toBe(true))
		fireEvent.click(screen.getByText('Setup'))
		expect(screen.getByText('Setup page')).toBeTruthy()
		expect(test.setNormalRecordingActive).toHaveBeenLastCalledWith(true, false)
		expect(test.dropEnabled).toHaveBeenLastCalledWith(false)
		await act(async () => { test.listeners.get('record_finish')?.({ payload: { path: '/tmp/audio.wav', name: 'audio.wav' } }) })
		await waitFor(() => expect(test.save).toHaveBeenCalledWith(expect.objectContaining({ sourcePath: '/tmp/audio.wav', projectsPath: '/projects', moveSourceMedia: true })))
		expect(test.hydrate).toHaveBeenCalled()
	})

	it('defers main-page initialization and drop handling when opening directly on setup', async () => {
		render(<MemoryRouter initialEntries={['/setup']}><SessionProvider><Routes><Route path="/" element={<Main />} /><Route path="/setup" element={<Setup />} /></Routes></SessionProvider></MemoryRouter>)
		await screen.findByText('Back to main')
		expect(test.dropEnabled).toHaveBeenLastCalledWith(false)
		expect(test.invoke).not.toHaveBeenCalledWith('get_models_folder')
		fireEvent.click(screen.getByText('Back to main'))
		await waitFor(() => expect(test.invoke).toHaveBeenCalledWith('get_models_folder'))
		expect(test.dropEnabled).toHaveBeenLastCalledWith(true)
	})
})
