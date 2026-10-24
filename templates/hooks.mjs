// Optional. Only needed if the recording changes data you must put back (access.dataChanges = "restored-by-hooks"),
// or if sign-in is not a plain email + password form.
//
// export async function before({ cfg }) { /* snapshot the rows the scenes will touch */ }
// export async function after({ cfg })  { /* restore them; runs even if recording fails */ }
// export async function login({ page, user, pass, cfg }) { /* custom sign-in */ }
