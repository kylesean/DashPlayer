/**
 * TranslateGemma 4B 的等价简化聊天模板（Jinja）。
 *
 * 该模型 GGUF 内嵌的官方模板要求消息 content 为结构化数组
 * （`[{"type":"text","source_lang_code":...}]`），纯字符串消息会在
 * llama-server `--jinja` 下触发模板解析失败、进程启动即退出。
 * 此模板与官方模板产出的提示词等价（`<start_of_turn>user/model` 轮次结构），
 * 官方模板真正的价值——训练时使用的翻译者前言——由客户端提示词负责。
 */
export const TRANSLATEGEMMA_4B_CHAT_TEMPLATE = `{%- for m in messages -%}
{%- if m.role == 'assistant' -%}
{{- '<start_of_turn>model\n' + (m.content | trim) + '<end_of_turn>\n' -}}
{%- else -%}
{{- '<start_of_turn>user\n' + (m.content | trim) + '<end_of_turn>\n' -}}
{%- endif -%}
{%- endfor -%}
{%- if add_generation_prompt -%}
{{- '<start_of_turn>model\n' -}}
{%- endif -%}
`;
