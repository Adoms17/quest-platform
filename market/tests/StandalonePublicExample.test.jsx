import { expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import StandalonePublicExample from '../src/StandalonePublicExample'

it('explains empty, wrong and correct answers and resets only its local state', () => {
  render(<StandalonePublicExample />)
  expect(screen.getByText(/Это не задание выбранного квеста/)).toBeVisible()
  const check = screen.getByRole('button', { name: 'Проверить', exact: true })
  fireEvent.click(check)
  expect(screen.getByRole('status')).toHaveTextContent('Сначала выберите')
  for (const name of ['Фонарь', 'Лупа']) {
    fireEvent.click(screen.getByRole('radio', { name }))
    fireEvent.click(check)
    expect(screen.getByRole('status')).toHaveTextContent('не определяет стороны света')
  }
  fireEvent.click(screen.getByRole('radio', { name: 'Компас' }))
  fireEvent.click(check)
  expect(screen.getByRole('status')).toHaveTextContent('Верно!')
  expect(screen.getByRole('status')).toHaveTextContent('магнитный север')
  fireEvent.click(screen.getByRole('button', { name: 'Начать заново' }))
  expect(screen.getByRole('radio', { name: 'Компас' })).not.toBeChecked()
  expect(screen.getByRole('radio', { name: 'Компас' })).toHaveFocus()
})
