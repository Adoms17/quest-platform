import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import QuickQuestAccessCode from './QuickQuestAccessCode'

it('нормализует полный код и передаёт его для продолжения', () => {
  const onContinue = vi.fn()
  render(<QuickQuestAccessCode onContinue={onContinue} />)

  const input = screen.getByLabelText('Получили код доступа к квесту?')
  const button = screen.getByRole('button', { name: 'Продолжить' })
  expect(button).toBeDisabled()

  fireEvent.change(input, { target: { value: 'a1b2c3 d4e5f6' } })
  expect(input).toHaveValue('A1B2C3-D4E5F6')
  expect(button).toBeEnabled()

  fireEvent.click(button)
  expect(onContinue).toHaveBeenCalledWith('A1B2C3-D4E5F6')
})

