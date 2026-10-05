/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CALL_AREA_PATCH, HEADER_PATCH, PANEL_PATCH } from "./patches";

const SELF = 'Vencord.Plugins.plugins["P2PCall"]';
// как canonicalizeMatch в Vencord: \i — идентификатор
const canon = (re: RegExp, global = false) =>
    new RegExp(re.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"), re.flags + (global ? "g" : ""));
const apply = (src: string, p: { replacement: { match: RegExp; replace: string; }; }) =>
    src.replace(canon(p.replacement.match), p.replacement.replace.replaceAll("$self", SELF));
const count = (src: string, re: RegExp) => [...src.matchAll(canon(re, true))].length;

const HEADER_SRC = 'lc.k.getConfig({location:"PrivateChannelCallButton"}).videoEnabled;'
    + "renderVoiceCallButton(){let e,c=!1;let u=(0,l.jsx)(td.Ay.Icon,{ref:this.iconRef,icon:ll._,onClick:this.handleVoiceClick,disabled:c,tooltip:e});"
    + "return(0,l.jsxs)(l.Fragment,{children:[u]})}"
    + "render(){return(0,l.jsxs)(s.Fragment,{children:[this.renderVoiceCallButton(),this.renderVideoCallButton()]})}handleStartCall=(e,t)=>{}";

const CALL_SRC = 'renderCall(){let{channel:e}=this.props;if(d()(null!=e,"Missing channel in Channel.renderCall"),!this.shouldRenderCall())return null}'
    + "render(){return(0,l.jsxs)(\"div\",{children:[E?null:null,f||c?null:this.renderHeaderBar(),this.renderCall(),this.renderEmbeddedActivityPanel(),x]})}";

const PANEL_SRC = ";return(0,i.jsx)(O.f5,{value:F,children:(0,i.jsx)(lb,{currentUser:e,username:D,activities:n,userTag:h,occluded:S,selfDeaf:v})})";
const PANEL_SPOTIFY_SRC = ';return(0,i.jsx)(O.f5,{value:F,children:(0,i.jsx)(Vencord.Plugins.plugins["SpotifyControls"].PanelWrapper,{VencordOriginal:lb,currentUser:e,username:D,userTag:h,occluded:S,selfDeaf:v})})';

test("header: find string is present and match hits once", () => {
    assert.ok(HEADER_SRC.includes(HEADER_PATCH.find));
    assert.equal(count(HEADER_SRC, HEADER_PATCH.replacement.match), 1);
});

test("header: appends our button with the captured HeaderBar component", () => {
    const out = apply(HEADER_SRC, HEADER_PATCH);
    assert.ok(out.includes(`children:[this.renderVoiceCallButton(),this.renderVideoCallButton(),${SELF}.renderHeaderButton(this.props.channel,td.Ay)]`));
    assert.ok(out.includes("(0,l.jsx)(td.Ay.Icon,{ref:this.iconRef"));
});

test("call area: inserted right before Discord's own renderCall()", () => {
    assert.ok(CALL_SRC.includes(CALL_AREA_PATCH.find));
    assert.equal(count(CALL_SRC, CALL_AREA_PATCH.replacement.match), 1);
    const out = apply(CALL_SRC, CALL_AREA_PATCH);
    assert.ok(out.includes(`this.renderHeaderBar(),${SELF}.renderCallArea(this.props.channel,this.props.height),this.renderCall(),this.renderEmbeddedActivityPanel()`));
});

test("panel: wraps the plain account panel", () => {
    const out = apply(PANEL_SRC, PANEL_PATCH);
    assert.ok(out.includes(`(0,i.jsx)(${SELF}.PanelWrapper,{P2POriginal:lb,currentUser:e`));
});

test("panel: wraps the SpotifyControls wrapper without clobbering VencordOriginal", () => {
    const out = apply(PANEL_SPOTIFY_SRC, PANEL_PATCH);
    assert.ok(out.includes(`(0,i.jsx)(${SELF}.PanelWrapper,{P2POriginal:Vencord.Plugins.plugins["SpotifyControls"].PanelWrapper,VencordOriginal:lb,`));
});
