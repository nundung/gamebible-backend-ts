'use strict';
var __awaiter =
    (this && this.__awaiter) ||
    function (thisArg, _arguments, P, generator) {
        function adopt(value) {
            return value instanceof P
                ? value
                : new P(function (resolve) {
                      resolve(value);
                  });
        }
        return new (P || (P = Promise))(function (resolve, reject) {
            function fulfilled(value) {
                try {
                    step(generator.next(value));
                } catch (e) {
                    reject(e);
                }
            }
            function rejected(value) {
                try {
                    step(generator['throw'](value));
                } catch (e) {
                    reject(e);
                }
            }
            function step(result) {
                result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
            }
            step((generator = generator.apply(thisArg, _arguments || [])).next());
        });
    };
var __importDefault =
    (this && this.__importDefault) ||
    function (mod) {
        return mod && mod.__esModule ? mod : { default: mod };
    };
Object.defineProperty(exports, '__esModule', { value: true });
const express_1 = require('express');
const express_validator_1 = require('express-validator');
const validator_1 = require('../middleware/validator');
const jsonwebtoken_1 = __importDefault(require('jsonwebtoken'));
const postges_1 = __importDefault(require('../config/postges'));
const bcrypt_1 = __importDefault(require('bcrypt'));
require('dotenv').config();
const router = (0, express_1.Router)();
//로그인
router.post(
    '/auth',
    (0, express_validator_1.body)('id')
        .trim()
        .isLength({ min: 4, max: 20 })
        .isString()
        .withMessage('아이디는 4자 이상 20자 이하로 해주세요.'),
    (0, express_validator_1.body)('pw')
        .trim()
        .isLength({ min: 8, max: 20 })
        .withMessage('비밀번호는 8자 이상 20자 이하이어야 합니다.'),
    validator_1.handleValidationErrors,
    (req, res, next) =>
        __awaiter(void 0, void 0, void 0, function* () {
            const { id, pw } = req.body;
            try {
                // 사용자 정보 조회 (비밀번호는 해시된 상태로 저장되어 있음)
                const values = [id];
                const { rows: userRows } = yield postges_1.default.query(
                    `
                SELECT
                    *
                FROM
                    account_local al
                JOIN
                    "user" u ON al.user_idx = u.idx
                WHERE
                    al.id = $1 AND u.deleted_at IS NULL`,
                    values
                );
                if (userRows.length === 0) {
                    return res.status(204).send({ message: '로그인 실패' });
                }
                // 제네릭: 타입을 동적으로 할당함. 그런 제네릭을 써야할 때가 있음
                const user = userRows[0];
                // bcrypt.compare 함수로 비밀번호 비교
                const match = yield bcrypt_1.default.compare(pw, user.pw);
                if (!match) {
                    return res.status(401).send({ message: '비밀번호 일치하지 않음' });
                }
                // 비밀번호가 일치하면 토큰 생성
                const token = jsonwebtoken_1.default.sign(
                    {
                        userIdx: user.user_idx,
                        isAdmin: user.is_admin,
                    },
                    process.env.SECRET_KEY || '',
                    {
                        expiresIn: '5h',
                    }
                );
                res.status(200).send({ kakaoLogin: false, token: token, data: user });
            } catch (e) {
                next(e);
            }
        })
);
exports.default = router;
