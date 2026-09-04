import { Component } from 'react'

export default class LazyRouteErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Ошибка загрузки lazy-маршрута:', error, errorInfo)
  }

  handleReload = () => {
    if (this.props.onReload) {
      this.props.onReload()
      return
    }

    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4 p-4 text-center">
          <p>Не удалось загрузить обновлённую версию страницы</p>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-sm bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Перезагрузить приложение
          </button>
        </div>
      )
    }

    return this.props.children
  }
}