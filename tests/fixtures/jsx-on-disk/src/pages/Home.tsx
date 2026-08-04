import { Button } from '../components/Button.js'

export function Home(): JSX.Element {
  return (
    <div className="page">
      <img src="/logo.png" />
      <Button label="Go" />
    </div>
  )
}
