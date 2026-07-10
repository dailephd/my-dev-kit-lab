# mixed-docs-claims fixture

Current: this fixture ships `com.example.Widget` (Java) and `com.example.Gadget`
(Kotlin), matching the classes actually present under `src/main/java` and
`src/main/kotlin` -- these are current, accurate claims about this fixture's
own source.

Planned (not yet implemented): Android-specific validation of this project's
JVM sources is planned for a later `v0.4.x` release track.

Out of scope: this fixture's `build.gradle.kts` is never executed by Gradle,
and `pom.xml`-style Maven execution is not performed against this project --
static classification only.

Future (not yet implemented): a combined `quality`, `project`, or `all`
audit type covering this fixture does not exist yet.
