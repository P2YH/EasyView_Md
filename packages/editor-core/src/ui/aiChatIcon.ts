import aiChatImage from '../../../../resources/editor/icons/ai-chat.png';

/** One generated PNG shared by the chat header and every entry point.
 * Its alpha mask follows currentColor in light/dark themes and active buttons.
 */
export const AI_CHAT_ICON_HTML = `<span class="ai-chat-icon" aria-hidden="true" style="display:inline-block;width:16px;height:16px;flex:0 0 16px;background-color:currentColor;-webkit-mask:url('${aiChatImage}') center/125% no-repeat;mask:url('${aiChatImage}') center/125% no-repeat"></span>`;
