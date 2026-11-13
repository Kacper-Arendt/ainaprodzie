// Stand-in for a Vite-hashed bundle. The real ones only exist when the maven
// frontend profile ran; what matters here is the /assets/ path and the hash in
// the name, which is what makes the file safe to cache forever.
export const built = true
