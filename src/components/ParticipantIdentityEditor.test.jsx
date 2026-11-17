import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import ParticipantIdentityEditor from './ParticipantIdentityEditor'
import * as api from '../services/participantIdentityApi'
import { prepareParticipantAvatar } from '../services/prepareParticipantAvatar'
vi.mock('../supabaseClient',()=>({supabase:{}}))
vi.mock('../services/participantIdentityApi',async original=>({...await original(),saveParticipantIdentity:vi.fn(),uploadParticipantAvatar:vi.fn(),cleanupParticipantAvatars:vi.fn(),downloadParticipantAvatar:vi.fn()}))
vi.mock('../services/prepareParticipantAvatar',()=>({prepareParticipantAvatar:vi.fn()}))
const profile={id:'profile-a',identity_revision:2,can_rename:true,can_participate:true,display_name:'Name',nickname:'Explorer'}
beforeEach(()=>{vi.clearAllMocks();api.saveParticipantIdentity.mockResolvedValue({});api.cleanupParticipantAvatars.mockResolvedValue();api.uploadParticipantAvatar.mockResolvedValue();URL.createObjectURL=vi.fn(()=>'blob:preview');URL.revokeObjectURL=vi.fn()})
it.each([{can_rename:false},{can_participate:false},{identity_revision:undefined}])('does not offer editing without the existing read/edit contract: %j',override=>{
 render(<ParticipantIdentityEditor profile={{...profile,...override}}/>);expect(screen.queryByRole('form')).not.toBeInTheDocument()
})
it('saves a separate nickname with revision, without changing the account or display name',async()=>{
 const saved=vi.fn();render(<ParticipantIdentityEditor profile={profile} onSaved={saved}/>)
 fireEvent.change(screen.getByLabelText('Никнейм (необязательно)'),{target:{value:'NewName'}})
 fireEvent.submit(screen.getByRole('form'));await waitFor(()=>expect(saved).toHaveBeenCalledOnce())
 expect(api.saveParticipantIdentity).toHaveBeenCalledWith('profile-a',2,'NewName',null,false)
 expect(api.uploadParticipantAvatar).not.toHaveBeenCalled()
})
it('rejects invalid nickname before any write',()=>{
 render(<ParticipantIdentityEditor profile={profile}/>);fireEvent.change(screen.getByLabelText('Никнейм (необязательно)'),{target:{value:'<svg>'}})
 fireEvent.submit(screen.getByRole('form'));expect(screen.getByRole('alert')).toBeInTheDocument();expect(api.saveParticipantIdentity).not.toHaveBeenCalled()
})
it('keeps an uncertain save visible and offers reload instead of announcing success',async()=>{
 api.saveParticipantIdentity.mockRejectedValue({code:'40001'});const saved=vi.fn(),reload=vi.fn()
 render(<ParticipantIdentityEditor profile={profile} onSaved={saved} onReload={reload}/>);fireEvent.submit(screen.getByRole('form'))
 expect(await screen.findByRole('alert')).toHaveTextContent('Профиль изменился');expect(saved).not.toHaveBeenCalled()
 fireEvent.click(screen.getByText('Обновить профиль'));expect(reload).toHaveBeenCalledOnce()
})
it('discards a late local image when switching profile',async()=>{
 let resolve;prepareParticipantAvatar.mockReturnValue(new Promise(r=>{resolve=r}))
 const view=render(<ParticipantIdentityEditor profile={profile}/>);fireEvent.change(screen.getByLabelText('Выбрать аватар'),{target:{files:[new File(['png'],'a.png',{type:'image/png'})]}})
 view.rerender(<ParticipantIdentityEditor profile={{...profile,id:'profile-b',nickname:'Other'}}/>)
 await act(async()=>resolve(new Blob(['converted'],{type:'image/png'})))
 expect(screen.queryByAltText('Предпросмотр нового аватара')).not.toBeInTheDocument();expect(URL.createObjectURL).not.toHaveBeenCalled();expect(api.uploadParticipantAvatar).not.toHaveBeenCalled()
})
it('uploads a local preview only on save, attaches once, and cleans obsolete objects',async()=>{
 prepareParticipantAvatar.mockResolvedValue(new Blob(['converted'],{type:'image/png'}));const saved=vi.fn()
 const view=render(<ParticipantIdentityEditor profile={profile} onSaved={saved}/>);fireEvent.change(screen.getByLabelText('Выбрать аватар'),{target:{files:[new File(['png'],'a.png',{type:'image/png'})]}})
 await screen.findByAltText('Предпросмотр нового аватара');expect(api.uploadParticipantAvatar).not.toHaveBeenCalled()
 fireEvent.submit(screen.getByRole('form'));fireEvent.submit(screen.getByRole('form'));await waitFor(()=>expect(saved).toHaveBeenCalledOnce())
 expect(api.uploadParticipantAvatar).toHaveBeenCalledOnce();expect(api.saveParticipantIdentity).toHaveBeenCalledOnce();expect(api.cleanupParticipantAvatars).toHaveBeenCalled()
 view.unmount();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
})
