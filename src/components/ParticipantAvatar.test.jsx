import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ParticipantAvatar from './ParticipantAvatar'
import { downloadParticipantAvatar } from '../services/participantIdentityApi'
vi.mock('../services/participantIdentityApi',()=>({downloadParticipantAvatar:vi.fn()}))
beforeEach(()=>{vi.clearAllMocks();URL.createObjectURL=vi.fn(()=>'blob:private');URL.revokeObjectURL=vi.fn();downloadParticipantAvatar.mockResolvedValue(new Blob(['png']))})
afterEach(()=>vi.useRealTimers())
it('downloads through authenticated storage, then revokes the local URL on unmount',async()=>{
 const view=render(<ParticipantAvatar profileId="a" path="a/upload.png" name="Alex"/>);await screen.findByRole('img')
 expect(downloadParticipantAvatar).toHaveBeenCalledWith('a','a/upload.png');view.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private')
})
it('shows initials when access is denied',async()=>{
 downloadParticipantAvatar.mockRejectedValue(Error('denied'));render(<ParticipantAvatar profileId="a" path="a/upload.png" name="Alex"/>);
 await waitFor(()=>expect(downloadParticipantAvatar).toHaveBeenCalled());expect(screen.queryByRole('img')).not.toBeInTheDocument();expect(screen.getByText('A')).toBeInTheDocument()
})
it('cannot display a stale download after profile change',async()=>{
 let resolve;downloadParticipantAvatar.mockReturnValue(new Promise(r=>{resolve=r}));const view=render(<ParticipantAvatar profileId="a" path="a/upload.png" name="Alex"/>);
 view.rerender(<ParticipantAvatar profileId="b" path={null} name="Bob"/>);await act(async()=>resolve(new Blob(['png'])))
 expect(URL.createObjectURL).not.toHaveBeenCalled();expect(screen.getByText('B')).toBeInTheDocument()
})
it('clears an already displayed image when the next 30-second permission check fails',async()=>{
 vi.useFakeTimers();render(<ParticipantAvatar profileId="a" path="a/upload.png" name="Alex"/>);
 await act(async()=>{});expect(screen.getByRole('img')).toBeInTheDocument();downloadParticipantAvatar.mockRejectedValue(Error('revoked'))
 await act(async()=>vi.advanceTimersByTimeAsync(30000));expect(screen.queryByRole('img')).not.toBeInTheDocument();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private')
})
