# mixed-java-kotlin fixture

Current: a conventional Gradle Kotlin DSL JVM project layout with one Java
class (`src/main/java/com/example/FooService.java`), one Kotlin class
(`src/main/kotlin/com/example/BarService.kt`), and matching test classes
under `src/test/java` and `src/test/kotlin`. `build.gradle.kts` and
`settings.gradle.kts` are present to prove Gradle Kotlin DSL build scripts
are classified as config, not Kotlin source. Used to prove Java and Kotlin
source facts coexist in one JVM-style project without disrupting each
other's declarations or role classification.
