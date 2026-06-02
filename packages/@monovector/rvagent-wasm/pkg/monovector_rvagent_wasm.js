/* @ts-self-types="./monovector_rvagent_wasm.d.ts" */

/**
 * A model provider that delegates to a JavaScript callback function.
 *
 * The JS callback receives a JSON string of messages and must return
 * a Promise that resolves to a JSON string response.
 *
 * # JavaScript usage
 * ```js
 * const provider = new JsModelProvider(async (messagesJson) => {
 *     const messages = JSON.parse(messagesJson);
 *     const response = await callMyModel(messages);
 *     return JSON.stringify(response);
 * });
 * ```
 */
class JsModelProvider {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JsModelProviderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_jsmodelprovider_free(ptr, 0);
    }
    /**
     * Send messages to the JS model provider and get a response.
     *
     * `messages_json` is a JSON-serialized array of message objects.
     * Returns the model's response as a JSON string.
     * @param {string} messages_json
     * @returns {Promise<string>}
     */
    complete(messages_json) {
        const ptr0 = passStringToWasm0(messages_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.jsmodelprovider_complete(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Create a new provider wrapping a JavaScript async function.
     *
     * The function must accept a JSON string and return a Promise<string>.
     * @param {Function} callback
     */
    constructor(callback) {
        const ret = wasm.jsmodelprovider_new(callback);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        JsModelProviderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) JsModelProvider.prototype[Symbol.dispose] = JsModelProvider.prototype.free;
exports.JsModelProvider = JsModelProvider;

/**
 * rvAgent WASM — browser and Node.js agent execution.
 *
 * Create with `new WasmAgent(configJson)` from JavaScript.
 */
class WasmAgent {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmAgentFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmagent_free(ptr, 0);
    }
    /**
     * Execute a tool directly by passing a JSON tool request.
     * @param {string} tool_json
     * @returns {any}
     */
    execute_tool(tool_json) {
        const ptr0 = passStringToWasm0(tool_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmagent_execute_tool(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get the number of files in the virtual filesystem.
     * @returns {number}
     */
    file_count() {
        const ret = wasm.wasmagent_file_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the current agent state as JSON.
     * @returns {any}
     */
    get_state() {
        const ret = wasm.wasmagent_get_state(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get the todo list as JSON.
     * @returns {any}
     */
    get_todos() {
        const ret = wasm.wasmagent_get_todos(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get the list of available tools.
     * @returns {any}
     */
    get_tools() {
        const ret = wasm.wasmagent_get_tools(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Check whether the agent is stopped.
     * @returns {boolean}
     */
    is_stopped() {
        const ret = wasm.wasmagent_is_stopped(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Get the configured model identifier.
     * @returns {string}
     */
    model() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmagent_model(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Get the agent name, if configured.
     * @returns {string | undefined}
     */
    name() {
        const ret = wasm.wasmagent_name(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Create a new WasmAgent from a JSON configuration string.
     *
     * # Example (JavaScript)
     * ```js
     * const agent = new WasmAgent('{"model": "anthropic:claude-sonnet-4-20250514"}');
     * ```
     * @param {string} config_json
     */
    constructor(config_json) {
        const ptr0 = passStringToWasm0(config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmagent_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmAgentFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Send a prompt and get a response.
     *
     * If a model provider is set, the prompt is sent to the JS model.
     * Otherwise, returns an echo response for testing.
     * @param {string} input
     * @returns {Promise<any>}
     */
    prompt(input) {
        const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmagent_prompt(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Reset the agent state, clearing messages and turn count.
     */
    reset() {
        wasm.wasmagent_reset(this.__wbg_ptr);
    }
    /**
     * Attach a JavaScript model provider callback.
     *
     * The callback receives a JSON string of messages and must return
     * a `Promise<string>` with the model response.
     * @param {Function} callback
     */
    set_model_provider(callback) {
        const ret = wasm.wasmagent_set_model_provider(this.__wbg_ptr, callback);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Get the current turn count.
     * @returns {number}
     */
    turn_count() {
        const ret = wasm.wasmagent_turn_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get the crate version.
     * @returns {string}
     */
    static version() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmagent_version();
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WasmAgent.prototype[Symbol.dispose] = WasmAgent.prototype.free;
exports.WasmAgent = WasmAgent;

/**
 * RVF App Gallery — browse, load, and configure agent templates.
 *
 * # Example (JavaScript)
 * ```js
 * const gallery = new WasmGallery();
 *
 * // List all templates
 * const templates = gallery.list();
 *
 * // Search by tags
 * const results = gallery.search("security testing");
 *
 * // Get template details
 * const template = gallery.get("coder");
 *
 * // Load as RVF container
 * const rvfBytes = gallery.loadRvf("coder");
 *
 * // Configure template
 * gallery.configure("coder", { maxTurns: 100 });
 * ```
 */
class WasmGallery {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmGalleryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmgallery_free(ptr, 0);
    }
    /**
     * Add a custom template to the gallery.
     * @param {string} template_json
     */
    addCustom(template_json) {
        const ptr0 = passStringToWasm0(template_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmgallery_addCustom(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Configure the active template with overrides.
     * @param {string} config_json
     */
    configure(config_json) {
        const ptr0 = passStringToWasm0(config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmgallery_configure(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Get the number of templates in the gallery.
     * @returns {number}
     */
    count() {
        const ret = wasm.wasmgallery_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Export all custom templates as JSON.
     * @returns {any}
     */
    exportCustom() {
        const ret = wasm.wasmgallery_exportCustom(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get a template by ID.
     * @param {string} id
     * @returns {any}
     */
    get(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmgallery_get(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get the currently active template ID.
     * @returns {string | undefined}
     */
    getActive() {
        const ret = wasm.wasmgallery_getActive(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getStringFromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * Get all categories with template counts.
     * @returns {any}
     */
    getCategories() {
        const ret = wasm.wasmgallery_getCategories(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get configuration overrides for active template.
     * @returns {any}
     */
    getConfig() {
        const ret = wasm.wasmgallery_getConfig(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Import custom templates from JSON.
     * @param {string} templates_json
     * @returns {number}
     */
    importCustom(templates_json) {
        const ptr0 = passStringToWasm0(templates_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmgallery_importCustom(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] >>> 0;
    }
    /**
     * List all available templates.
     * @returns {any}
     */
    list() {
        const ret = wasm.wasmgallery_list(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * List templates by category.
     * @param {string} category
     * @returns {any}
     */
    listByCategory(category) {
        const ptr0 = passStringToWasm0(category, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmgallery_listByCategory(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Load a template as an RVF container (returns Uint8Array).
     * @param {string} id
     * @returns {Uint8Array}
     */
    loadRvf(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmgallery_loadRvf(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Create a new gallery with built-in templates.
     */
    constructor() {
        const ret = wasm.wasmgallery_new();
        this.__wbg_ptr = ret;
        WasmGalleryFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Remove a custom template by ID.
     * @param {string} id
     */
    removeCustom(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmgallery_removeCustom(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Search templates by query (matches name, description, tags).
     * @param {string} query
     * @returns {any}
     */
    search(query) {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmgallery_search(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Set a template as active for use.
     * @param {string} id
     */
    setActive(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmgallery_setActive(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) WasmGallery.prototype[Symbol.dispose] = WasmGallery.prototype.free;
exports.WasmGallery = WasmGallery;

/**
 * WASM MCP Server — runs the MCP protocol entirely in the browser.
 *
 * This server exposes rvAgent tools via MCP JSON-RPC, enabling integration
 * with MCP clients without requiring a separate server process.
 *
 * # Example (JavaScript)
 * ```js
 * const mcp = new WasmMcpServer("rvagent-wasm");
 *
 * // Handle request
 * const response = mcp.handleRequest(JSON.stringify({
 *     jsonrpc: "2.0",
 *     id: 1,
 *     method: "tools/list",
 *     params: {}
 * }));
 * console.log(response);
 * ```
 */
class WasmMcpServer {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmMcpServerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmmcpserver_free(ptr, 0);
    }
    /**
     * Execute a tool by name with JSON parameters.
     * @param {string} name
     * @param {string} params_json
     * @returns {any}
     */
    call_tool(name, params_json) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(params_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmcpserver_call_tool(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get the gallery instance for direct access.
     * @returns {any}
     */
    gallery() {
        const ret = wasm.wasmmcpserver_gallery(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Handle a JSON-RPC request and return a JSON-RPC response.
     * @param {string} request_json
     * @returns {any}
     */
    handle_request(request_json) {
        const ptr0 = passStringToWasm0(request_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmcpserver_handle_request(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Check if the server has been initialized.
     * @returns {boolean}
     */
    is_initialized() {
        const ret = wasm.wasmmcpserver_is_initialized(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Get the list of available tools as JSON.
     * @returns {any}
     */
    list_tools() {
        const ret = wasm.wasmmcpserver_list_tools(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get the server name.
     * @returns {string}
     */
    name() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmmcpserver_name(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Create a new WasmMcpServer with the given name.
     * @param {string} name
     */
    constructor(name) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmmcpserver_new(ptr0, len0);
        this.__wbg_ptr = ret;
        WasmMcpServerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Get the server version.
     * @returns {string}
     */
    version() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.wasmmcpserver_version(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) WasmMcpServer.prototype[Symbol.dispose] = WasmMcpServer.prototype.free;
exports.WasmMcpServer = WasmMcpServer;

/**
 * RVF Container Builder for WASM.
 *
 * Build RVF cognitive containers that package tools, prompts, skills,
 * orchestrator configs, MCP tools, and Ruvix capabilities.
 *
 * # Example (JavaScript)
 * ```js
 * const builder = new WasmRvfBuilder();
 * builder.addTool({ name: "search", description: "Web search", parameters: {} });
 * builder.addPrompt({ name: "coder", system_prompt: "You are a coder", version: "1.0" });
 * const container = builder.build();
 * // container is Uint8Array with RVF magic bytes
 * ```
 */
class WasmRvfBuilder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmRvfBuilderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmrvfbuilder_free(ptr, 0);
    }
    /**
     * Add Ruvix capability definitions.
     * @param {string} caps_json
     */
    addCapabilities(caps_json) {
        const ptr0 = passStringToWasm0(caps_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_addCapabilities(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Add MCP tool entries.
     * @param {string} tools_json
     */
    addMcpTools(tools_json) {
        const ptr0 = passStringToWasm0(tools_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_addMcpTools(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Add an agent prompt.
     * @param {string} prompt_json
     */
    addPrompt(prompt_json) {
        const ptr0 = passStringToWasm0(prompt_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_addPrompt(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Add multiple prompts from JSON array.
     * @param {string} prompts_json
     */
    addPrompts(prompts_json) {
        const ptr0 = passStringToWasm0(prompts_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_addPrompts(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Add a skill definition.
     * @param {string} skill_json
     */
    addSkill(skill_json) {
        const ptr0 = passStringToWasm0(skill_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_addSkill(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Add multiple skills from JSON array.
     * @param {string} skills_json
     */
    addSkills(skills_json) {
        const ptr0 = passStringToWasm0(skills_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_addSkills(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Add a tool definition.
     * @param {string} tool_json
     */
    addTool(tool_json) {
        const ptr0 = passStringToWasm0(tool_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_addTool(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Add multiple tools from JSON array.
     * @param {string} tools_json
     */
    addTools(tools_json) {
        const ptr0 = passStringToWasm0(tools_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_addTools(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Build the RVF container as bytes.
     *
     * Returns a Uint8Array containing the RVF binary:
     * - Magic bytes: "RVF\x01" (4 bytes)
     * - Segment count: u32 LE (4 bytes)
     * - Segments: type(1) + tag(2) + len(4) + data
     * - Checksum: SHA3-256 (32 bytes)
     * @returns {Uint8Array}
     */
    build() {
        const ret = wasm.wasmrvfbuilder_build(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Get the RVF magic bytes for detection.
     * @returns {Uint8Array}
     */
    static getMagic() {
        const ret = wasm.wasmrvfbuilder_getMagic();
        return ret;
    }
    /**
     * Create a new RVF container builder.
     */
    constructor() {
        const ret = wasm.wasmrvfbuilder_new();
        this.__wbg_ptr = ret;
        WasmRvfBuilderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Parse an RVF container from bytes.
     * @param {Uint8Array} data
     * @returns {any}
     */
    static parse(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_parse(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Set orchestrator configuration.
     * @param {string} config_json
     */
    setOrchestrator(config_json) {
        const ptr0 = passStringToWasm0(config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_setOrchestrator(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Validate an RVF container (check magic and checksum).
     * @param {Uint8Array} data
     * @returns {boolean}
     */
    static validate(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.wasmrvfbuilder_validate(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
}
if (Symbol.dispose) WasmRvfBuilder.prototype[Symbol.dispose] = WasmRvfBuilder.prototype.free;
exports.WasmRvfBuilder = WasmRvfBuilder;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_function_754e9f305ff6029e: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_undefined_67b456be8673d3d7: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_string_get_72bdf95d3ae505b1: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_1506f2235d1bdba0: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_61db23ac97f16c31: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_call_9c758de292015997: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_instanceof_Promise_d0db99486956c8e8: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Promise;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_new_from_slice_18fa1f71286d66b8: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_bf31d18f92484486: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h1cbaebde3e8f3d88(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_parse_03863847d06c4e89: function() { return handleError(function (arg0, arg1) {
            const ret = JSON.parse(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_queueMicrotask_35c611f4a14830b2: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_queueMicrotask_404ed0a58e0b63cc: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_resolve_25a7e548d5881dca: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_static_accessor_GLOBAL_9d53f2689e622ca1: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_a1a35cec07001a8a: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_4c59f6c7ea29a144: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_e70ae9f2eb052253: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_then_18f476d590e58992: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_ac7b025999b52837: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 93, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__hc8b0ff15296c7802);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./monovector_rvagent_wasm_bg.js": import0,
    };
}

function wasm_bindgen__convert__closures_____invoke__hc8b0ff15296c7802(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__hc8b0ff15296c7802(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h1cbaebde3e8f3d88(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h1cbaebde3e8f3d88(arg0, arg1, arg2, arg3);
}

const JsModelProviderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_jsmodelprovider_free(ptr, 1));
const WasmAgentFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmagent_free(ptr, 1));
const WasmGalleryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmgallery_free(ptr, 1));
const WasmMcpServerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmmcpserver_free(ptr, 1));
const WasmRvfBuilderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmrvfbuilder_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/monovector_rvagent_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
