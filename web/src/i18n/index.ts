/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zh from './locales/zh.json'
import en from './locales/en.json'

i18n.use(initReactI18next).init({
    resources: {
        zh: { translation: zh },
        en: { translation: en },
    },
    lng: (() => {
        try {
            const stored = localStorage.getItem('language')
            if (stored) return stored
            const navLang = navigator.language?.toLowerCase() ?? ''
            if (navLang.startsWith('zh')) return 'zh'
            return 'en'
        } catch {
            return 'zh'
        }
    })(),
    fallbackLng: 'en',
    interpolation: {
        escapeValue: false, // React 已经处理 XSS
    },
})

export default i18n
