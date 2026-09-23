/** Type declarations for the stylesheets this package imports. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

/** A side-effect stylesheet import carries no exports. */
declare module '*.css'
