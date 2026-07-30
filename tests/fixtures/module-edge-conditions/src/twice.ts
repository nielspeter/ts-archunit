// TWO runtime re-exports of one banned module. They share an identity (bug 0028,
// pre-existing and out of scope here), which is why item 12 asserts the
// relpath:line multiset as well as the identity set.
export { SECRET } from './banned/secret.js'
export { SECRET as Again } from './banned/secret.js'
