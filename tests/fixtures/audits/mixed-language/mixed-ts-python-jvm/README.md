# mixed-ts-python-jvm fixture

Current: TypeScript, JavaScript, Python, Java, and Kotlin source files
coexisting in one target, plus a `build.gradle.kts` JVM metadata file. Used
to prove all currently-supported language families (v0.3.3 baseline) can be
collected together without crashing, without cross-language schema drift,
and without one analyzer's output disturbing another's.

Planned (not implemented): Android-specific source-set validation and
manual pentest coverage are out of scope for this fixture and for v0.3.4.
