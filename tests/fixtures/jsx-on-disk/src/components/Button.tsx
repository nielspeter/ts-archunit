export function Button(props: { label: string }): JSX.Element {
  return (
    <button className="btn" onClick={undefined}>
      {props.label}
    </button>
  )
}
