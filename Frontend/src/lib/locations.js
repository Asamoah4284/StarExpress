/** @param {string} id @param {{id:string,name:string}[]} list */
export function locationNameById(id, list) {
  return list.find((l) => l.id === id)?.name ?? id
}
