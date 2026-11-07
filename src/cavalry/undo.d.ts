// Load host namespaces without the package's console (Node supplies that in CI).
/// <reference types="@scenery/cavalry-types/namespaces/api" />
/// <reference types="@scenery/cavalry-types/namespaces/ui" />
/// <reference types="@scenery/cavalry-types/namespaces/cavalry" />

declare namespace api {
	function startUndoGroup(name: string): void
	function endUndoGroup(): void
}
