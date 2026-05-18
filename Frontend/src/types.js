/**
 * @typedef {Object} AuthUser
 * @property {string} [id]
 * @property {string} name
 * @property {string} email
 * @property {string} [phone]
 * @property {string} role
 */

/**
 * @typedef {Object} TeamUserRow
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {string} role
 * @property {boolean} active
 */

/**
 * @typedef {Object} Sale
 * @property {string} id
 * @property {string} customerName
 * @property {string} [customerPhone]
 * @property {string} [paymentNumber]
 * @property {string} packageType
 * @property {number} amount
 * @property {string} locationId
 * @property {string} date
 * @property {'Completed'|'Pending'|'Cancelled'} status
 * @property {string} [voucherCode]
 */

export {}
