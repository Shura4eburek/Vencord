/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Проверено по бандлу discord.com от 2026-10-05. При поломке после обновления Discord
// сверить фрагменты в patches.test.ts с новым бандлом.

/** Кнопка в шапке ЛС: третьим элементом после голосового и видеозвонка, тем же компонентом иконки шапки */
export const HEADER_PATCH = {
    find: 'location:"PrivateChannelCallButton"',
    replacement: {
        match: /(\i\.\i)(\.Icon,\{ref:this\.iconRef.+?children:\[this\.renderVoiceCallButton\(\),this\.renderVideoCallButton\(\))/,
        replace: "$1$2,$self.renderHeaderButton(this.props.channel,$1)",
    },
};

/** Область звонка: наш подписанный компонент прямо перед областью звонка Discord */
export const CALL_AREA_PATCH = {
    find: '"Missing channel in Channel.renderCall"',
    replacement: {
        match: /this\.renderCall\(\),(?=this\.renderEmbeddedActivityPanel\(\))/,
        replace: "$self.renderCallArea(this.props.channel,this.props.height),$&",
    },
};

/** Плашка над аккаунтом. Принимает и обёртку SpotifyControls, свой проп — P2POriginal */
export const PANEL_PATCH = {
    find: "#{intl::USER_PROFILE_ACCOUNT_POPOUT_BUTTON_A11Y_LABEL}",
    replacement: {
        match: /(?<=\i\.jsxs?\)\()(\i|Vencord\.Plugins\.plugins\["\w+"\]\.\w+),\{(?=[^}]*?userTag:\i,occluded:)/,
        replace: "$self.PanelWrapper,{P2POriginal:$1,",
    },
};
