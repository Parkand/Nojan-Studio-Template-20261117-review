'use server';

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from './db';
import { requireUser, createSession, clearSession } from './auth';
import { siteHome } from './site-config.mjs';
import type { ActionState } from './types';

const txt = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const idSchema = z.coerce.number().int().positive();
const nameSchema = z.string().trim()
  .min(2, 'نام باید حداقل دو حرف باشد.')
  .max(100, 'نام بیش از حد طولانی است.');
const userSchema = z.string().trim().toLowerCase()
  .regex(
    /^[a-z0-9_.-]{3,64}$/,
    'نام کاربری باید ۳ تا ۶۴ نویسه انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.'
  );
const passSchema = z.string()
  .min(10, 'رمز عبور حداقل ۱۰ نویسه باشد.')
  .max(64, 'رمز عبور حداکثر ۶۴ نویسه باشد.')
  .refine(
    p => Buffer.byteLength(p, 'utf8') <= 72,
    'رمز عبور با این حروف بیش از حد طولانی است.'
  );

function fail(message: string): never {
  throw new Error(message);
}

function message(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? 'ورودی نامعتبر است.';
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return 'این نام کاربری قبلاً ثبت شده است؛ حتی اگر حذف شده باشد.';
    }
    if (error.code === 'P2034') {
      return 'اطلاعات هم‌زمان تغییر کرده‌اند. دوباره تلاش کنید.';
    }
    console.error('Database operation failed:', error.code);
    return 'عملیات پایگاه داده انجام نشد. دوباره تلاش کنید.';
  }
  if (
    error instanceof Error &&
    !(error instanceof Prisma.PrismaClientInitializationError) &&
    !(error instanceof Prisma.PrismaClientValidationError)
  ) {
    return error.message;
  }
  console.error(error);
  return 'خطای ارتباط با دیتابیس. تنظیمات اتصال را بررسی کنید.';
}

// Serializable transactions protect role, session and concurrent user changes.
const transaction = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
) => db.$transaction(fn, {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 15000
});

export async function loginAction(
  _: ActionState,
  f: FormData
): Promise<ActionState> {
  try {
    const username = userSchema.parse(txt(f, 'username'));
    const password = String(f.get('password') ?? '');
    if (!password || password.length > 128) {
      return { error: 'نام کاربری یا رمز عبور نادرست است.' };
    }
    const user = await db.user.findUnique({ where: { username } });
    // Compare a hash even when the username is unknown.
    const valid = await bcrypt.compare(
      password,
      user?.passwordHash ??
        '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5tE2HgbE5ZV6HVUOD90WWsj3Dl7V1bK'
    );
    if (!user || user.deletedAt) {
      return { error: 'نام کاربری یا رمز عبور نادرست است.' };
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return { error: 'ورود موقتاً محدود شده؛ ۱۵ دقیقه بعد تلاش کنید.' };
    }
    if (!valid) {
      await transaction(async tx => {
        const latest = await tx.user.findUniqueOrThrow({
          where: { id: user.id }
        });
        const attempts = latest.lockedUntil && latest.lockedUntil <= new Date()
          ? 1 : latest.failedLoginAttempts + 1;
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: attempts,
            lockedUntil: attempts >= 5
              ? new Date(Date.now() + 15 * 60 * 1000) : null
          }
        });
      });
      return { error: 'نام کاربری یا رمز عبور نادرست است.' };
    }
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null }
    });
    await createSession(user.id, user.sessionVersion);
  } catch (e) {
    console.error('Login failed', e);
    return {
      error: 'ورود انجام نشد. اطلاعات ورودی و اتصال دیتابیس را بررسی کنید.'
    };
  }
  redirect(siteHome());
}

export async function logoutAction() {
  await clearSession();
  redirect('/login');
}

export async function mutateAction(
  _: ActionState,
  f: FormData
): Promise<ActionState> {
  const actor = await requireUser();
  try {
    const action = txt(f, 'action');
    // Explicit allowlist: removed and unknown operations never reach the DB.
    if (action !== 'user.save' && action !== 'user.delete') {
      fail('عملیات نامعتبر است.');
    }
    if (actor.role !== 'SUPER_ADMIN') {
      fail('مدیریت کاربران و نقش‌ها فقط توسط مدیر ارشد مجاز است.');
    }
    const id = txt(f, 'id') ? idSchema.parse(txt(f, 'id')) : null;
    const created = { createdById: actor.id, updatedById: actor.id };
    const updated = { updatedById: actor.id };
    const removed = {
      deletedAt: new Date(), deletedById: actor.id, ...updated
    };
    const data = action === 'user.save'
      ? {
        name: nameSchema.parse(txt(f, 'name')),
        username: userSchema.parse(txt(f, 'username')),
        role: z.enum(['USER', 'ADMIN', 'SUPER_ADMIN']).parse(txt(f, 'role'))
      }
      : null;
    const password = action === 'user.save' ? String(f.get('password') ?? '') : '';
    const passwordHash = password
      ? await bcrypt.hash(passSchema.parse(password), 12) : undefined;
    if (action === 'user.save' && !id && !passwordHash) {
      fail('رمز عبور برای کاربر جدید الزامی است.');
    }

    await transaction(async tx => {
      // Re-check role and session validity inside the transaction.
      const current = await tx.user.findFirst({
        where: {
          id: actor.id,
          deletedAt: null,
          role: 'SUPER_ADMIN',
          sessionVersion: actor.sessionVersion
        }
      });
      if (!current) {
        fail('دسترسی مدیر ارشد معتبر نیست. دوباره وارد شوید.');
      }
      if (id) {
        const target = await tx.user.findFirst({ where: { id, deletedAt: null } });
        if (!target) fail('کاربر پیدا نشد.');
        if (
          id === actor.id &&
          (action === 'user.delete' || data?.role !== 'SUPER_ADMIN')
        ) {
          fail('حذف حساب خود یا تغییر نقش خودتان مجاز نیست.');
        }
        if (data?.role === 'SUPER_ADMIN' && target.role !== 'SUPER_ADMIN') {
          fail('ارتقا به مدیر ارشد از طریق فرم کاربران مجاز نیست.');
        }
        if (
          target.role === 'SUPER_ADMIN' && data &&
          data.username !== target.username
        ) {
          fail('تغییر نام کاربری مدیر ارشد مجاز نیست.');
        }
        if (
          target.role === 'SUPER_ADMIN' &&
          (action === 'user.delete' || data?.role !== 'SUPER_ADMIN')
        ) {
          const superAdminCount = await tx.user.count({
            where: { role: 'SUPER_ADMIN', deletedAt: null }
          });
          if (superAdminCount <= 1) {
            fail('حداقل یک مدیر ارشد فعال باید باقی بماند.');
          }
        }
        if (action === 'user.delete') {
          await tx.user.update({
            where: { id },
            data: { ...removed, sessionVersion: { increment: 1 } }
          });
        } else {
          if (!data) fail('اطلاعات کاربر معتبر نیست.');
          await tx.user.update({
            where: { id },
            data: {
              ...data,
              ...(passwordHash ? { passwordHash } : {}),
              ...updated,
              sessionVersion: { increment: 1 },
              failedLoginAttempts: 0,
              lockedUntil: null
            }
          });
        }
      } else if (data) {
        if (data.role === 'SUPER_ADMIN') {
          fail('ایجاد مدیر ارشد از طریق فرم کاربران مجاز نیست.');
        }
        if (!passwordHash) fail('رمز عبور برای کاربر جدید الزامی است.');
        await tx.user.create({ data: { ...data, passwordHash, ...created } });
      } else {
        fail('شناسه نامعتبر است.');
      }
    });
  } catch (e) {
    return { error: message(e) };
  }
  revalidatePath('/', 'layout');
  redirect('/users?saved=1');
}
