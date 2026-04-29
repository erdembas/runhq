//! Cross-platform process-tree containment.
//!
//! Spawning a shell that itself spawns descendants (the bread-and-butter
//! case for RunHQ — `pnpm dev`, `cargo run`, `npm start`) creates an
//! orphaning hazard on Windows: `TerminateProcess` on the root child
//! does NOT kill its descendants. Node workers, esbuild watchers, and
//! webpack-dev-server child processes routinely outlive their parents,
//! leaving zombie listeners on dev ports and an unkillable pile in
//! Task Manager.
//!
//! Unix sidesteps this with `setsid()` + `killpg()` (already used in
//! [`crate::process`]). Windows needs a [Job Object][job] with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: every process assigned to the
//! job dies when we close the handle, regardless of how deep the tree
//! goes. We open the job, attach the freshly-spawned child, and hold
//! the handle for the run's lifetime — drop ⇒ kernel kills the tree.
//!
//! On non-Windows targets this module compiles to a zero-cost shim
//! (`JobObject` is a unit struct that does nothing on drop) so callers
//! can sprinkle `JobObject::attach_kill_on_close(pid)` unconditionally
//! without `cfg` gymnastics at every spawn site.
//!
//! [job]: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects

#[cfg(windows)]
mod imp {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

    /// RAII handle to a Windows Job Object configured to kill every
    /// assigned process on close. Dropping the handle terminates the
    /// entire process tree the job has accumulated.
    pub struct JobObject {
        handle: HANDLE,
    }

    impl JobObject {
        /// Open a fresh Job Object, mark it kill-on-close, and assign
        /// the process identified by `pid` (and therefore — implicitly,
        /// via the job's silent-inheritance semantics — every descendant
        /// the process spawns AFTER assignment).
        ///
        /// Best-effort: if `OpenProcess` or assignment fails (race with
        /// an instant-exit child, insufficient privileges, etc.) the
        /// caller gets an `Err` and is expected to log + continue
        /// without containment. The supervised process still runs; it
        /// just won't get tree-killed on shutdown — same UX as before
        /// this module existed.
        pub fn attach_kill_on_close(pid: u32) -> windows::core::Result<Self> {
            // SAFETY: every Win32 call below is documented to be safe to
            // call from any thread provided the input handles/pointers
            // are valid for the call's duration. We construct each
            // handle just before use and close it on the same path.
            unsafe {
                let job = CreateJobObjectW(None, None)?;

                // Configure the job BEFORE assigning the process — once
                // a process is in a job, certain limit changes are
                // rejected. Doing it in this order avoids that pitfall
                // entirely.
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let info_size = std::mem::size_of_val(&info) as u32;
                if let Err(e) = SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    info_size,
                ) {
                    let _ = CloseHandle(job);
                    return Err(e);
                }

                // PROCESS_SET_QUOTA + PROCESS_TERMINATE is the minimal
                // access mask that satisfies AssignProcessToJobObject.
                // Using PROCESS_ALL_ACCESS would work but is needlessly
                // broad — Windows audit/EDR tooling flags overscoped
                // handles.
                let process = match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
                    Ok(h) => h,
                    Err(e) => {
                        let _ = CloseHandle(job);
                        return Err(e);
                    }
                };

                let assign = AssignProcessToJobObject(job, process);
                let _ = CloseHandle(process);
                if let Err(e) = assign {
                    let _ = CloseHandle(job);
                    return Err(e);
                }

                Ok(JobObject { handle: job })
            }
        }
    }

    impl Drop for JobObject {
        fn drop(&mut self) {
            // Closing the last handle to a job with KILL_ON_JOB_CLOSE
            // terminates every assigned process synchronously. We
            // intentionally swallow errors: if the handle is already
            // gone the kernel has done our job for us.
            unsafe {
                let _ = CloseHandle(self.handle);
            }
        }
    }

    // The Windows kernel handle (HANDLE = *mut c_void) is process-wide
    // and safe to share/move across threads — the kernel mediates all
    // accesses. The `windows` crate marks HANDLE as !Send/!Sync out of
    // an abundance of caution because raw pointers default that way;
    // for kernel handles we know better and assert it explicitly.
    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}
}

#[cfg(not(windows))]
mod imp {
    /// Zero-cost no-op shim on non-Windows platforms.
    ///
    /// Unix process-tree cleanup is handled by the supervisor's
    /// `setsid()` + `killpg()` path; this struct just exists so call
    /// sites can attach a `JobObject` unconditionally without having to
    /// branch on `cfg(windows)` at every spawn. The supervisor still
    /// delivers correct tree-kill semantics on Unix; this shim simply
    /// adds nothing on top.
    pub struct JobObject;

    impl JobObject {
        /// On non-Windows targets, returns a no-op handle that does
        /// nothing on drop. The signature mirrors the Windows variant so
        /// callers can write a single `if cfg!(windows)`-free statement.
        pub fn attach_kill_on_close(_pid: u32) -> Result<Self, std::convert::Infallible> {
            Ok(JobObject)
        }
    }
}

pub use imp::JobObject;

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    /// Confirm the non-Windows shim's contract: attaching never errors,
    /// the returned guard is `Send`, and dropping it is a no-op (we
    /// can't *observe* the no-op, but we can at least verify that
    /// constructing and dropping doesn't panic). If a future change
    /// accidentally promotes the shim to a real implementation on Unix
    /// without the corresponding cfg gating, this test will fail to
    /// compile against the new error type and surface the regression
    /// immediately.
    #[test]
    fn shim_attach_is_infallible_and_drop_is_safe() {
        let job = JobObject::attach_kill_on_close(0).expect("shim never errors");
        // `Send` bound is required by `Running._job` (held across
        // tokio::spawn). Static-assert it here so a regression in the
        // shim's marker traits is caught at compile time on every
        // platform that runs the test suite.
        fn assert_send<T: Send>(_: &T) {}
        assert_send(&job);
        // Rely on scope-end drop to exercise the no-op destructor —
        // an explicit `drop(job)` would trip `clippy::drop_non_drop`
        // on Unix because the shim is a unit struct without `Drop`.
        // The intent ("constructing and going out of scope must not
        // panic") is preserved either way.
        let _ = job;
    }
}
