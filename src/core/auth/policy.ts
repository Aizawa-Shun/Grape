/**
 * Password rules, kept apart from core/auth/users.ts so the register form can
 * import them.
 *
 * users.ts reaches the database, and a "use client" module that imports it
 * pulls @libsql/client into the browser bundle, where the web build refuses
 * the file: URL the local database uses and takes the whole page down. A bare
 * constant module has nothing to drag along.
 */

/**
 * Long rather than complicated. Composition rules push people towards
 * predictable substitutions; length is the thing that actually costs an
 * attacker something, and this is typed once and then kept in a password
 * manager. The owner's password guards every service on the instance and the
 * button that spends money, so it is not the place to be accommodating.
 */
export const MIN_PASSWORD_LENGTH = 12;
