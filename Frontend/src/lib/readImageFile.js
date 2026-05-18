const MAX_LOGO_BYTES = 400 * 1024

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export function readImageFileAsDataUrl(file) {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("Please choose an image file (PNG, JPEG, GIF, WebP, or SVG)."))
  }
  if (file.size > MAX_LOGO_BYTES) {
    return Promise.reject(new Error("Logo must be under 400 KB."))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      if (!result.startsWith("data:image/")) {
        reject(new Error("Could not read image file."))
        return
      }
      resolve(result)
    }
    reader.onerror = () => reject(new Error("Could not read image file."))
    reader.readAsDataURL(file)
  })
}
