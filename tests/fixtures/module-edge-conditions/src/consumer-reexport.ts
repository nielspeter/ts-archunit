// A RUNTIME re-export of a banned module. Invisible to every forward condition
// before 0.28.0 — this is bug 0022's headline shape.
export { SECRET } from './banned/secret.js'
