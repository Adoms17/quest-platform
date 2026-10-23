import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import ParticipantGroupMembers from './ParticipantGroupMembers'
vi.mock('../supabaseClient',()=>({supabase:{}}))
vi.mock('../hooks/usePeopleCatalog',()=>({usePeopleCatalog:()=>({group:{name:'Group',can_manage:false,can_leave:false},items:[
 {id:'one',display_name:'Participant',nickname:'Explorer',avatar_path:'one/avatar.png',member_role:'member'},
 {id:'two',display_name:'No image',nickname:null,avatar_path:null,member_role:'member'},
]})}))
vi.mock('../components/ParticipantAvatar',()=>({default:({profileId,path,name})=><span data-testid={`avatar-${profileId}`} data-path={path}>{name} avatar</span>}))
it('renders name, optional nickname and the matching private avatar without changing links or roles',()=>{
 render(<MemoryRouter initialEntries={['/group/group-id']}><Routes><Route path="/group/:groupId" element={<ParticipantGroupMembers session={{user:{id:'actor'}}}/>}/></Routes></MemoryRouter>)
 expect(screen.getByRole('heading',{name:'Participant'})).toBeInTheDocument();expect(screen.getByText('Никнейм: Explorer')).toBeInTheDocument()
 expect(screen.getByTestId('avatar-one')).toHaveAttribute('data-path','one/avatar.png')
 expect(screen.getByRole('link',{name:'Открыть профиль: Participant'})).toHaveAttribute('href','/participants/group/profiles/one')
 expect(screen.getAllByText('Участник группы')).toHaveLength(2)
 expect(screen.queryByText('Никнейм: null')).not.toBeInTheDocument()
})
