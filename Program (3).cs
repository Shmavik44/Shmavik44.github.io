using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Telegram.Bot;
using Telegram.Bot.Exceptions;
using Telegram.Bot.Polling;
using Telegram.Bot.Types;
using Telegram.Bot.Types.Enums;
using Telegram.Bot.Types.ReplyMarkups;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

class Program
{
    private static readonly string BotToken = "8735350197:AAFbO2GWxBai79Dm8Dz3cpM9i-PsOnysajs"; 
    private static readonly long GroupId = -1003852812518;
    private static readonly int TopicUkrId = 2;
    private static readonly int TopicContactId = 3;
    private static readonly int TopicAbsenceId = 35;
    private static readonly int TopicCourseworkId = 200;

    private static readonly List<long> AdminIds = new() { 1492389359, 1654156923 }; 
    private static readonly string UsersFile = "users.txt"; 

    private static Dictionary<long, string> UserStates = new();
    private static Dictionary<int, long> MessageMap = new();
    private static Dictionary<string, List<Message>> _mediaGroupCache = new();

    private static readonly string GroupList = 
        "📋 <b>Список групи:</b>\n1 Базунов Дмитро\n2 Волков Микола\n3 Гриценко Микола\n4 Жук Тимофій\n5 Калашник Даниїл\n6 Клименко Іван\n<s>7 Криницький Дмитро</s>\n8 Мартиненко Валерій\n9 Постернак Роман\n10 Притула Дмитро\n<s>11 Савчук Микола</s>\n12 Скірко Анна\n13 Узун Дмитро\n14 Фулга Іван\n15 Ханчопуло Ольга";

    static async Task Main(string[] args)
    {
        AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

        using (var db = new AppDbContext())
        {
            db.Database.EnsureCreated();
            try 
            {
                db.Database.ExecuteSqlRaw("ALTER TABLE \"Students\" ADD COLUMN IF NOT EXISTS \"Coins\" integer NOT NULL DEFAULT 0;");
                db.Database.ExecuteSqlRaw("ALTER TABLE \"Students\" ADD COLUMN IF NOT EXISTS \"ActiveTitle\" text DEFAULT 'Студент 🤓';");
                db.Database.ExecuteSqlRaw("ALTER TABLE \"Students\" ADD COLUMN IF NOT EXISTS \"UnlockedTitles\" text DEFAULT 'Студент 🤓';");
                db.Database.ExecuteSqlRaw("ALTER TABLE \"StudentTasks\" ADD COLUMN IF NOT EXISTS \"CompletionDate\" timestamp with time zone;");
                db.Database.ExecuteSqlRaw("ALTER TABLE \"Students\" ADD COLUMN IF NOT EXISTS \"StreakCount\" integer NOT NULL DEFAULT 0;");
                db.Database.ExecuteSqlRaw("ALTER TABLE \"Students\" ADD COLUMN IF NOT EXISTS \"LastLoginDate\" timestamp with time zone;");
                db.Database.ExecuteSqlRaw("ALTER TABLE \"Students\" ADD COLUMN IF NOT EXISTS \"LootboxSpins\" integer NOT NULL DEFAULT 0;");
                db.Database.ExecuteSqlRaw("ALTER TABLE \"Students\" ADD COLUMN IF NOT EXISTS \"HasChillBonus\" boolean NOT NULL DEFAULT false;");
                db.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS \"AttendanceRecords\" (\"Id\" serial PRIMARY KEY, \"StudentName\" text NOT NULL, \"Subject\" text NOT NULL, \"Date\" timestamp with time zone NOT NULL, \"IsPresent\" boolean NOT NULL);");
                db.Database.ExecuteSqlRaw("CREATE TABLE IF NOT EXISTS \"Announcements\" (\"Id\" serial PRIMARY KEY, \"Title\" text, \"Text\" text, \"Created\" timestamp with time zone NOT NULL, \"Expires\" timestamp with time zone NOT NULL);");
            } 
            catch (Exception ex) { Console.WriteLine($"Помилка міграцій: {ex.Message}"); }
        }

        _ = Task.Run(() => StartApiServer(args));

        var botClient = new TelegramBotClient(BotToken);
        using CancellationTokenSource cts = new();
        botClient.StartReceiving(HandleUpdateAsync, HandlePollingErrorAsync, new ReceiverOptions { AllowedUpdates = Array.Empty<UpdateType>() }, cts.Token);

        Console.WriteLine("Бот запущений!");
        await Task.Delay(-1);
    }

    static HashSet<long> GetUsers()
    {
        if (!System.IO.File.Exists(UsersFile)) return new HashSet<long>();
        try {
            return new HashSet<long>(System.IO.File.ReadAllLines(UsersFile).Where(l => !string.IsNullOrWhiteSpace(l)).Select(long.Parse));
        } catch { return new HashSet<long>(); }
    }

    static void SaveUser(long chatId, string firstName)
    {
        var users = GetUsers();
        if (!users.Contains(chatId)) {
            try { System.IO.File.AppendAllText(UsersFile, chatId + Environment.NewLine); } catch { }
        }

        try
        {
            using var db = new AppDbContext();
            var student = db.Students.FirstOrDefault(s => s.TelegramId == chatId);
            if (student == null)
            {
                db.Students.Add(new Student { TelegramId = chatId, FirstName = firstName });
                db.SaveChanges();
            }
            else if (student.FirstName == "Студент" && firstName != "Студент" && !string.IsNullOrWhiteSpace(firstName))
            {
                student.FirstName = firstName;
                db.SaveChanges();
            }
        }
        catch { }
    }

    static string GetSchedule(bool tomorrow = false)
    {
        DateTime semesterStart = new DateTime(2026, 3, 2); 
        DateTime targetDate = DateTime.UtcNow.AddHours(2); 
        if (tomorrow) targetDate = targetDate.AddDays(1);

        int daysPassed = (targetDate.Date - semesterStart.Date).Days;
        if (daysPassed < 0) return "⏳ Навчання ще не почалося.";

        int weekIndex = daysPassed / 7;
        int weekType = (weekIndex % 2 == 0) ? 1 : 2;
        DayOfWeek day = targetDate.DayOfWeek;

        if (day == DayOfWeek.Saturday || day == DayOfWeek.Sunday)
        {
            string dayWord = tomorrow ? "Завтра" : "Сьогодні";
            return $"🎉 {dayWord} вихідний! Пар немає. Можна відпочити!";
        }

        string dayHeader = tomorrow ? "на завтра" : "на сьогодні";
        string schedule = $"📅 **Розклад {dayHeader}**\n(Це {weekType}-й тиждень, {GetDayName(day)}):\n\n";

        if (weekType == 1)
        {
            schedule += day switch
            {
                DayOfWeek.Monday => "Практика\n 1. (8:30-10:25)  Спимо \n2. (10:25-12:20) [Основи здорового способу життя](https://us02web.zoom.us/j/4387354937?pwd=R3R3NkpWU09GY3kvanZBeEcrQWZoUT09) \n3. (12:20-13:55) Українська мова посилання у класрум \n4. (14:15-16:10) [Фізика](https://us04web.zoom.us/j/73299617033?pwd=4rxt7nZWOLq9HrKngCmaZuxnHSXXAL.1#success) \n ",
                DayOfWeek.Tuesday => " Лекції\n1. (8:30-10:25) [Фізика](https://us02web.zoom.us/j/82238545736?pwd=MGZXaWhvWlBOLzRSWU9qRTZVRk1ndz09#success) \n2.(10:25-12:20) [Теорія алгоритмів](https://us05web.zoom.us/j/7484031746?pwd=UzZveU1PL3gyYWNPYzVMVmh4bVhiZz09)\n3. (12:20-14:15) [Українська мова](https://us05web.zoom.us/j/89476862941?pwd=JsR3LwWeNORMTIOcZabxXIBwp1jNsU.1)\n",
                DayOfWeek.Wednesday => "Практика\n1.(8:30-10:25) [Програмування](https://discord.com/invite/NK5eWG9Szq) \n2. (10:25-12:20) [Англійська мова](https://us04web.zoom.us/j/4957917875?pwd=YXB3TjJxUWp5eHF3N3RGcnJWSGJzQT09#success)\n3. (12:20-14:10) [Чисельні методи](https://us05web.zoom.us/j/5673966902?pwd=VnVhSVk2YUdKSEZSSTFhRTFuR1VDZz09) \n ",
                DayOfWeek.Thursday => "Лекції\n1.(8:30-10:25) [Програмування](https://us04web.zoom.us/j/8215712072?pwd=enZRZmI0L1pjNmZTb3lHZjF5Snp0QT09)\n2. (10:25-12:20) [Чисельні методи](https://us02web.zoom.us/j/89356398855?pwd=Y0FYQ3hIbHc3c0dlNFVPRHFTZkN4dz09)\n3. (12:20-14:10) [Вища математика](https://us02web.zoom.us/j/86763697204?pwd=E5zSkI1GIHn3okYHJBxYBDQtJJdWyW.1)\n4. (14:15-16:10) [Вища математика](https://us02web.zoom.us/j/89779057947?pwd=wGgorW6pVGrAvAGZEtRrUp88L1auHh.1#success)\n  ",
                DayOfWeek.Friday => "Практика\n1.(8:30-10:25) Cпимо\n2. (10:25-12:20) [Теорія алгоритмів](https://us02web.zoom.us/j/9033143189?pwd=MEQreWJNUHp5a0dNM2hIbHZEc2R6Zz09)\n3. (12:20-14:10) [Вища математика](https://us04web.zoom.us/j/2313886209?pwd=dnZHanV3cU9LUXJBVWYyYVArUFg5dz09#success)  ",
                _ => ""
            };
        }
        else // Якщо 2-й тиждень
        {
            schedule += day switch
            {
                DayOfWeek.Monday => "Практика\n 1. (8:30-10:25)  Спимо \n2. (10:25-12:20) [Основи здорового способу життя](https://us02web.zoom.us/j/4387354937?pwd=R3R3NkpWU09GY3kvanZBeEcrQWZoUT09) \n3. (12:20-13:55) [Фізика](https://us04web.zoom.us/j/73299617033?pwd=4rxt7nZWOLq9HrKngCmaZuxnHSXXAL.1#success)  \n4. (14:15-16:10) [Фізика](https://us04web.zoom.us/j/73299617033?pwd=4rxt7nZWOLq9HrKngCmaZuxnHSXXAL.1#success)\n",
                DayOfWeek.Tuesday => "Лекції\n1. (8:30-10:25) [Фізика](https://us02web.zoom.us/j/82238545736?pwd=MGZXaWhvWlBOLzRSWU9qRTZVRk1ndz09#success) \n2.(10:25-12:20) [Теорія алгоритмів](https://us05web.zoom.us/j/7484031746?pwd=UzZveU1PL3gyYWNPYzVMVmh4bVhiZz09)\n3. (12:20-14:15) [Теорія алгоритмів](https://us05web.zoom.us/j/7484031746?pwd=UzZveU1PL3gyYWNPYzVMVmh4bVhiZz09)\n ",
                DayOfWeek.Wednesday => "Практика\n1.(8:30-10:25) [Програмування](https://discord.com/invite/NK5eWG9Szq) \n2. (10:25-12:20) [Англійська мова](https://us04web.zoom.us/j/4957917875?pwd=YXB3TjJxUWp5eHF3N3RGcnJWSGJzQT09#success)\n3. (12:20-14:10) [Чисельні методи](https://us05web.zoom.us/j/5673966902?pwd=VnVhSVk2YUdKSEZSSTFhRTFuR1VDZz09) \n4. (14:15-16:10) [Англійська мова](https://us04web.zoom.us/j/4957917875?pwd=YXB3TjJxUWp5eHF3N3RGcnJWSGJzQT09#success)\n ",
                DayOfWeek.Thursday => "Лекції\n1.(8:30-10:25) [Програмування](https://us04web.zoom.us/j/8215712072?pwd=enZRZmI0L1pjNmZTb3lHZjF5Snp0QT09)\n2. (10:25-12:20) [Чисельні методи](https://us02web.zoom.us/j/89356398855?pwd=Y0FYQ3hIbHc3c0dlNFVPRHFTZkN4dz09)\n3. (12:20-14:10) [Вища математика](https://us02web.zoom.us/j/86763697204?pwd=E5zSkI1GIHn3okYHJBxYBDQtJJdWyW.1)\n4. (14:15-16:10) [Вища математика](https://us02web.zoom.us/j/89779057947?pwd=wGgorW6pVGrAvAGZEtRrUp88L1auHh.1#success)\n  ",
                DayOfWeek.Friday => "Практика\n1.(8:30-10:25) Cпимо\n2. (10:25-12:20) [Теорія алгоритмів](https://us02web.zoom.us/j/9033143189?pwd=MEQreWJNUHp5a0dNM2hIbHZEc2R6Zz09)\n3. (12:20-14:10) [Вища математика](https://us04web.zoom.us/j/2313886209?pwd=dnZHanV3cU9LUXJBVWYyYVArUFg5dz09#success)  ",
                _ => ""
            };
        }

        return schedule;
    }

    static string GetDayName(DayOfWeek day) => day switch
    {
        DayOfWeek.Monday => "Понеділок", DayOfWeek.Tuesday => "Вівторок", DayOfWeek.Wednesday => "Середа",
        DayOfWeek.Thursday => "Четвер", DayOfWeek.Friday => "П'ятниця", _ => ""
    };

    static async Task ShowMainMenu(ITelegramBotClient botClient, long chatId, CancellationToken cancellationToken)
    {
        var inlineKeyboard = new InlineKeyboardMarkup(new[]
        {
            new [] { InlineKeyboardButton.WithCallbackData("📅 На сьогодні", "schedule"), InlineKeyboardButton.WithCallbackData("📅 На завтра", "schedule_tomorrow") }, 
            new [] { InlineKeyboardButton.WithCallbackData("📝 Українська мова", "ukr"), InlineKeyboardButton.WithCallbackData("🎓 Курсова", "coursework") },
            new [] { InlineKeyboardButton.WithCallbackData("📋 Список (Варіант)", "list"), InlineKeyboardButton.WithCallbackData("⚠️ Відсутність", "absence") } 
        });

        await botClient.SendTextMessageAsync(chatId, "Обери категорію для повідомлення:", replyMarkup: inlineKeyboard, cancellationToken: cancellationToken);
    }

    static void StartApiServer(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);
        builder.Services.AddCors();
        var app = builder.Build();
        app.UseCors(policy => policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader());

        app.MapGet("/", () => "API is running! 🤖");

        app.MapGet("/api/tasks/{userId}", (long userId) =>
        {
            using var db = new AppDbContext();
            var student = db.Students.FirstOrDefault(s => s.TelegramId == userId);
            if (student == null) { student = new Student { TelegramId = userId, FirstName = "Студент" }; db.Students.Add(student); db.SaveChanges(); }

            var allTasks = db.TaskItems.ToList();
            var studentTaskIds = db.StudentTasks.Where(st => st.StudentTelegramId == userId).Select(st => st.TaskItemId).ToList();
            bool needsSave = false;

            foreach (var task in allTasks) {
                if (!studentTaskIds.Contains(task.Id)) { db.StudentTasks.Add(new StudentTask { StudentTelegramId = userId, TaskItemId = task.Id, IsCompleted = false }); needsSave = true; }
            }
            if (needsSave) db.SaveChanges();

            return Results.Ok(db.StudentTasks.Include(st => st.TaskItem).Where(st => st.StudentTelegramId == userId)
                .Select(st => new { TaskId = st.TaskItem!.Id, Subject = st.TaskItem.Subject, Title = st.TaskItem.Title, Deadline = st.TaskItem.Deadline, IsCompleted = st.IsCompleted, CompletionDate = st.CompletionDate }).ToList());
        });

        // ============================================================
        // 🔒 COMPLETE TASK — З БЛОКУВАННЯМ ПІСЛЯ ДЕДЛАЙНУ
        // ============================================================
        app.MapPost("/api/tasks/{studentId}/complete/{taskId}", (long studentId, int taskId) => 
        {
            using var db = new AppDbContext();
            var studentTask = db.StudentTasks
                .Include(st => st.TaskItem)
                .FirstOrDefault(st => st.StudentTelegramId == studentId && st.TaskItemId == taskId);

            if (studentTask == null) return Results.NotFound();

           // 🔒 LOCK: блокуємо тільки якщо в назві є [lock] І дедлайн минув
if (!studentTask.IsCompleted && studentTask.TaskItem != null)
{
    bool hasLockTag = studentTask.TaskItem.Title != null && 
                      studentTask.TaskItem.Title.Contains("[lock]", StringComparison.OrdinalIgnoreCase);
    
    if (hasLockTag && studentTask.TaskItem.Deadline < DateTime.UtcNow)
    {
        return Results.BadRequest(new { error = "locked", message = "Завдання з міткою [lock] заблоковано після дедлайну." });
    }
}

            var student = db.Students.FirstOrDefault(s => s.TelegramId == studentId);
            if (!studentTask.IsCompleted) 
            { 
                studentTask.IsCompleted = true; 
                studentTask.CompletionDate = DateTime.UtcNow; 
                if (student != null) student.Coins += 10; 
            } 
            else 
            { 
                studentTask.IsCompleted = false; 
                studentTask.CompletionDate = null; 
            }
            db.SaveChanges(); 
            return Results.Ok(new { success = true, isCompleted = studentTask.IsCompleted });
        });

        app.MapGet("/api/rank/{userId}", (long userId) =>
        {
            using var db = new AppDbContext();
            var students = db.Students.Where(s => s.FirstName != null && !s.FirstName.StartsWith("Гість")).ToList();
            var allTasks = db.StudentTasks.ToList();
            var stats = students.Select(s => {
                var userTasks = allTasks.Where(t => t.StudentTelegramId == s.TelegramId).ToList();
                int total = userTasks.Count; int completed = userTasks.Count(t => t.IsCompleted);
                int percent = total > 0 ? (int)Math.Round((double)completed / total * 100) : 0;
                return new { s.TelegramId, Percent = percent };
            }).OrderByDescending(x => x.Percent).ToList();

            return Results.Ok(new { rank = stats.FindIndex(x => x.TelegramId == userId) + 1, total = stats.Count });
        });

        app.MapGet("/api/user/{userId}", (long userId) =>
        {
            using var db = new AppDbContext();
            var student = db.Students.FirstOrDefault(s => s.TelegramId == userId);
            if (student == null) return Results.NotFound();
            var today = DateTime.UtcNow.Date;
            bool canClaim = !student.LastLoginDate.HasValue || student.LastLoginDate.Value.Date < today;

            return Results.Ok(new { coins = student.Coins, activeTitle = student.ActiveTitle, unlockedTitles = student.UnlockedTitles, streak = student.StreakCount, canClaim = canClaim, spins = student.LootboxSpins, hasChillBonus = student.HasChillBonus });
        });

        app.MapPost("/api/chill/bonus/{userId}", (long userId) =>
        {
            using var db = new AppDbContext();
            var student = db.Students.FirstOrDefault(s => s.TelegramId == userId);
            if (student == null) return Results.NotFound();

            bool bonusGiven = false;
            if (!student.HasChillBonus) { student.Coins += 150; student.HasChillBonus = true; bonusGiven = true; db.SaveChanges(); }
            return Results.Ok(new { coins = student.Coins, hasChillBonus = student.HasChillBonus, bonusGiven });
        });

        app.MapPost("/api/lootbox/{userId}", (long userId) =>
        {
            using var db = new AppDbContext();
            var student = db.Students.FirstOrDefault(s => s.TelegramId == userId);
            if (student == null || student.Coins < 50) return Results.BadRequest(new { message = "Бракує коїнів" });

            student.Coins -= 50;
            student.LootboxSpins++;

            int roll = Random.Shared.Next(1, 1001);
            string prizeType = "empty"; string message = ""; int coinsWon = 0;

            if (roll <= 315) {
                prizeType = "empty"; message = "💨 Пусто...";
            } else if (roll <= 515) {
                prizeType = "small"; coinsWon = 10; message = "🍬 Втішний приз: +10 🪙"; student.Coins += coinsWon;
            } else if (roll <= 695) {
                prizeType = "medium"; coinsWon = 50; message = "💸 Окуп! +50 🪙"; student.Coins += coinsWon;
            } else if (roll <= 845) {
                prizeType = "large"; coinsWon = 80; message = "🤑 Плюс! +80 🪙"; student.Coins += coinsWon;
            } else if (roll <= 945) {
                prizeType = "skin"; 
                string[] basicSkins = { "Новачок 🐣", "Любитель кави ☕", "Спить на парах 😴", "Дедлайн-кілер 🥷" };
                string wonSkin = basicSkins[Random.Shared.Next(basicSkins.Length)];
                if (student.UnlockedTitles == null) student.UnlockedTitles = "Студент 🤓";
                if (!student.UnlockedTitles.Contains(wonSkin)) {
                    student.UnlockedTitles += "," + wonSkin; message = $"🎁 Новий Скін: {wonSkin}!";
                } else {
                    student.Coins += 50; message = $"🎁 Скін {wonSkin} вже є: Кешбек +50 🪙";
                }
            } else if (roll <= 985) {
                prizeType = "epic"; coinsWon = 200; message = "💎 ДЖЕКПОТ! +200 🪙"; student.Coins += coinsWon;
            } else {
                prizeType = "legendary"; 
                if (student.UnlockedTitles == null) student.UnlockedTitles = "Студент 🤓";
                if (!student.UnlockedTitles.Contains("Син маминої подруги 🦸‍♂️")) {
                    student.UnlockedTitles += ",Син маминої подруги 🦸‍♂️"; message = "🦸‍♂️ ЛЕГЕНДА: Титул 'Син маминої подруги'!";
                } else {
                    student.Coins += 150; message = "🦸‍♂️ ЛЕГЕНДА (Дублікат): Кешбек +150 🪙";
                }
            }

            db.SaveChanges();
            return Results.Ok(new { prizeType, message, coins = student.Coins, unlockedTitles = student.UnlockedTitles, spins = student.LootboxSpins });
        });

        app.MapPost("/api/bonus/{userId}", (long userId) => 
        { 
            using var db = new AppDbContext();
            var student = db.Students.FirstOrDefault(s => s.TelegramId == userId);
            if (student == null) return Results.NotFound();

            var today = DateTime.UtcNow.Date;
            if (student.LastLoginDate.HasValue && student.LastLoginDate.Value.Date == today) return Results.BadRequest();

            if (student.LastLoginDate.HasValue && student.LastLoginDate.Value.Date == today.AddDays(-1)) student.StreakCount++;
            else student.StreakCount = 1;

            int reward = 10 + (student.StreakCount * 5);
            student.Coins += reward; student.LastLoginDate = DateTime.UtcNow;
            db.SaveChanges(); return Results.Ok(new { coins = student.Coins, streak = student.StreakCount, reward = reward });
        });

        app.MapPost("/api/user/{userId}/title", async (long userId, HttpContext context) =>
        {
            using var reader = new StreamReader(context.Request.Body);
            using var doc = JsonDocument.Parse(await reader.ReadToEndAsync());
            string? action = doc.RootElement.GetProperty("action").GetString();
            string? titleName = doc.RootElement.GetProperty("title").GetString();
            if (string.IsNullOrEmpty(action) || string.IsNullOrEmpty(titleName)) return Results.BadRequest();

            using var db = new AppDbContext();
            var student = db.Students.FirstOrDefault(s => s.TelegramId == userId);
            if (student == null) return Results.NotFound();

            if (action == "buy") {
                int price = doc.RootElement.GetProperty("price").GetInt32();
                if (student.Coins >= price && (student.UnlockedTitles == null || !student.UnlockedTitles.Contains(titleName))) {
                    student.Coins -= price; student.UnlockedTitles = (string.IsNullOrEmpty(student.UnlockedTitles) ? "" : student.UnlockedTitles + ",") + titleName;
                    student.ActiveTitle = titleName; db.SaveChanges(); return Results.Ok();
                }
            } else if (action == "equip") {
                if (student.UnlockedTitles != null && student.UnlockedTitles.Contains(titleName)) { student.ActiveTitle = titleName; db.SaveChanges(); return Results.Ok(); }
            }
            return Results.BadRequest();
        });

        app.MapPost("/api/attendance", async (HttpContext context) =>
        {
            using var reader = new StreamReader(context.Request.Body);
            using var doc = JsonDocument.Parse(await reader.ReadToEndAsync());
            string? subject = doc.RootElement.GetProperty("subject").GetString();
            var records = doc.RootElement.GetProperty("records").EnumerateArray();
            if (string.IsNullOrEmpty(subject)) return Results.BadRequest();

            using var db = new AppDbContext();
            foreach(var rec in records) {
                string? studentName = rec.GetProperty("name").GetString(); bool isPresent = rec.GetProperty("isPresent").GetBoolean();
                if (!string.IsNullOrEmpty(studentName)) { db.Database.ExecuteSqlRaw("INSERT INTO \"AttendanceRecords\" (\"StudentName\", \"Subject\", \"Date\", \"IsPresent\") VALUES ({0}, {1}, {2}, {3})", studentName, subject, DateTime.UtcNow, isPresent); }
            }
            db.SaveChanges(); return Results.Ok(new { success = true });
        });

        // ============================================================
        // 👑 АДМІН: отримати всі завдання
        // ============================================================
        app.MapGet("/api/admin/tasks", () =>
        {
            using var db = new AppDbContext();
            return Results.Ok(db.TaskItems
                .OrderBy(t => t.Deadline)
                .Select(t => new { t.Id, t.Subject, t.Title, t.Deadline })
                .ToList());
        });

        // ============================================================
        // 👑 АДМІН: додати нове завдання всім студентам
        // ============================================================
        app.MapPost("/api/tasks", async (HttpContext context) =>
        {
            using var reader = new StreamReader(context.Request.Body);
            using var doc = JsonDocument.Parse(await reader.ReadToEndAsync());

            string? subject  = doc.RootElement.GetProperty("subject").GetString();
            string? title    = doc.RootElement.GetProperty("title").GetString();
            string? deadlineStr = doc.RootElement.GetProperty("deadline").GetString();

            if (string.IsNullOrEmpty(subject) || string.IsNullOrEmpty(title) || string.IsNullOrEmpty(deadlineStr))
                return Results.BadRequest(new { error = "Заповни всі поля" });

            if (!DateTime.TryParse(deadlineStr, out DateTime deadline))
                return Results.BadRequest(new { error = "Невірний формат дати" });

            deadline = DateTime.SpecifyKind(deadline, DateTimeKind.Utc);

            using var db = new AppDbContext();
            var task = new TaskItem { Subject = subject, Title = title, Deadline = deadline };
            db.TaskItems.Add(task);
            db.SaveChanges();

            // Автоматично роздаємо завдання всім студентам
            var allStudents = db.Students.ToList();
            foreach (var student in allStudents)
                db.StudentTasks.Add(new StudentTask { StudentTelegramId = student.TelegramId, TaskItemId = task.Id, IsCompleted = false });
            db.SaveChanges();

            return Results.Ok(new { success = true, taskId = task.Id });
        });

        // ============================================================
        // 👑 АДМІН: видалити завдання
        // ============================================================
        app.MapDelete("/api/tasks/{taskId}", (int taskId) =>
        {
            using var db = new AppDbContext();
            var task = db.TaskItems.Find(taskId);
            if (task == null) return Results.NotFound();

            // Спочатку видаляємо всі StudentTask пов'язані з цим завданням
            var linked = db.StudentTasks.Where(st => st.TaskItemId == taskId).ToList();
            db.StudentTasks.RemoveRange(linked);
            db.TaskItems.Remove(task);
            db.SaveChanges();

            return Results.Ok(new { success = true });
        });

        // ============================================================
        // 📢 ОГОЛОШЕННЯ
        // ============================================================

        // GET — без userId (фронтенд викликає без userId)
        app.MapGet("/api/announcements", () =>
        {
            using var db = new AppDbContext();
            var announcements = db.Announcements
                .OrderByDescending(a => a.Created)
                .Select(a => new { a.Id, a.Title, a.Text, createdAt = a.Created, expiresAt = a.Expires })
                .ToList();
            return Results.Ok(announcements);
        });

        // GET — з userId (для сумісності)
        app.MapGet("/api/announcements/{userId}", (long userId) =>
        {
            using var db = new AppDbContext();
            var announcements = db.Announcements
                .OrderByDescending(a => a.Created)
                .Select(a => new { a.Id, a.Title, a.Text, createdAt = a.Created, expiresAt = a.Expires })
                .ToList();
            return Results.Ok(announcements);
        });

        // POST — додати нове оголошення (адмін)
        app.MapPost("/api/announcements", async (HttpContext context) =>
        {
            using var reader = new StreamReader(context.Request.Body);
            using var doc = JsonDocument.Parse(await reader.ReadToEndAsync());

            string? title = doc.RootElement.GetProperty("title").GetString();
            string? text = doc.RootElement.GetProperty("text").GetString();
            string? expiresStr = doc.RootElement.GetProperty("expiresAt").GetString();

            if (string.IsNullOrEmpty(title) || string.IsNullOrEmpty(text) || string.IsNullOrEmpty(expiresStr))
                return Results.BadRequest(new { error = "Заповни всі поля (title, text, expiresAt)" });

            if (!DateTime.TryParse(expiresStr, out DateTime expires))
                return Results.BadRequest(new { error = "Невірний формат дати expires" });

            expires = DateTime.SpecifyKind(expires, DateTimeKind.Utc);

            using var db = new AppDbContext();
            var announcement = new Announcement
            {
                Title = title,
                Text = text,
                Created = DateTime.UtcNow,
                Expires = expires
            };
            db.Announcements.Add(announcement);
            db.SaveChanges();

            return Results.Ok(new { success = true, id = announcement.Id });
        });

        // DELETE — видалити оголошення (адмін)
        app.MapDelete("/api/announcements/{id}", (int id) =>
        {
            using var db = new AppDbContext();
            var announcement = db.Announcements.Find(id);
            if (announcement == null) return Results.NotFound(new { error = "Оголошення не знайдено" });

            db.Announcements.Remove(announcement);
            db.SaveChanges();
            return Results.Ok(new { success = true });
        });

        // ДИНАМІЧНИЙ ПОРТ ДЛЯ RENDER
        var port = Environment.GetEnvironmentVariable("PORT") ?? "7860";
        app.Urls.Add($"http://0.0.0.0:{port}");
        app.Run();
    }

    static async Task HandleUpdateAsync(ITelegramBotClient botClient, Update update, CancellationToken cancellationToken)
    {
        if (update.Type == UpdateType.CallbackQuery && update.CallbackQuery?.Message != null)
        {
            var chatId = update.CallbackQuery.Message.Chat.Id;
            var action = update.CallbackQuery.Data;
            SaveUser(chatId, update.CallbackQuery.From?.FirstName ?? "Студент"); 

            if (action == "schedule" || action == "schedule_tomorrow") { await botClient.SendTextMessageAsync(chatId, GetSchedule(action == "schedule_tomorrow"), parseMode: ParseMode.Markdown, cancellationToken: cancellationToken); await ShowMainMenu(botClient, chatId, cancellationToken); return; }
            if (action == "list") { await botClient.SendTextMessageAsync(chatId, GroupList, parseMode: ParseMode.Html, cancellationToken: cancellationToken); return; }
            if (action != null) UserStates[chatId] = action;

            string replyText = action switch { "ukr" => "📚 Надішли файл або текст завдання з мови:\n\n Обов'язково напиши номер роботи\n", "coursework" => "🎓 Надішли свої матеріали, файли, архіви або питання по Курсовій роботі:", "absence" => "⚠️ Попередження про відсутність.\n\nОбов'язково напиши одним повідомленням:\n1. На якій парі тебе не буде.\n2. Чому тебе не буде (причина).", _ => "Обери дію." };
            await botClient.SendTextMessageAsync(chatId, replyText, cancellationToken: cancellationToken); return;
        }

        if (update.Type == UpdateType.Message && update.Message != null)
        {
            var message = update.Message;
            if (message.Chat.Type == ChatType.Private)
            {
                SaveUser(message.Chat.Id, message.From?.FirstName ?? "Студент"); 
                
                if (message.Text == "/report" && AdminIds.Contains(message.Chat.Id)) {
                    await botClient.SendTextMessageAsync(message.Chat.Id, "⏳ Формую звіт...", cancellationToken: cancellationToken);
                    try {
                        using var db = new AppDbContext(); var students = db.Students.Where(s => s.FirstName != null && !s.FirstName.StartsWith("Гість")).ToList(); var allTasks = db.StudentTasks.Include(t => t.TaskItem).ToList();
                        var sb = new StringBuilder(); sb.AppendLine("Прізвище та Ім'я;Всього завдань;Виконано;Боргів;Успішність %");
                        foreach (var s in students) { var sTasks = allTasks.Where(t => t.StudentTelegramId == s.TelegramId).ToList(); int total = sTasks.Count; int completed = sTasks.Count(t => t.IsCompleted); int overdue = sTasks.Count(t => !t.IsCompleted && t.TaskItem != null && t.TaskItem.Deadline < DateTime.UtcNow); int percent = total > 0 ? (int)Math.Round((double)completed / total * 100) : 0; sb.AppendLine($"{s.FirstName};{total};{completed};{overdue};{percent}%"); }
                        var csvBytes = Encoding.UTF8.GetPreamble().Concat(Encoding.UTF8.GetBytes(sb.ToString())).ToArray(); using var stream = new MemoryStream(csvBytes); var inputFile = InputFile.FromStream(stream, $"Звіт_{DateTime.Now:dd_MM_yyyy}.csv");
                        if (inputFile != null) await botClient.SendDocumentAsync(message.Chat.Id, inputFile, caption: "📊 Звіт!", cancellationToken: cancellationToken);
                    } catch (Exception ex) { await botClient.SendTextMessageAsync(message.Chat.Id, $"❌ Помилка: {ex.Message}", cancellationToken: cancellationToken); } return;
                }

                if (message.Type == MessageType.Document && AdminIds.Contains(message.Chat.Id)) {
                    var document = message.Document;
                    if (document != null && document.FileName != null && document.FileName.EndsWith(".json")) {
                        await botClient.SendTextMessageAsync(message.Chat.Id, "⏳ Обробляю файл...", cancellationToken: cancellationToken);
                        try {
                            if (document.FileId == null) return; var fileInfo = await botClient.GetFileAsync(document.FileId, cancellationToken); if (fileInfo == null || fileInfo.FilePath == null) return;
                            using var stream = new MemoryStream(); await botClient.DownloadFileAsync(fileInfo.FilePath, stream, cancellationToken); stream.Position = 0; using var reader = new StreamReader(stream); var jsonContent = await reader.ReadToEndAsync(cancellationToken); var newTasks = JsonSerializer.Deserialize<List<TaskItem>>(jsonContent);
                            if (newTasks != null && newTasks.Count > 0) {
                                using var db = new AppDbContext(); var allStudents = db.Students.ToList(); 
                                foreach (var task in newTasks) { task.Deadline = DateTime.SpecifyKind(task.Deadline, DateTimeKind.Utc); task.Id = 0; db.TaskItems.Add(task); db.SaveChanges(); foreach (var student in allStudents) db.StudentTasks.Add(new StudentTask { StudentTelegramId = student.TelegramId, TaskItemId = task.Id, IsCompleted = false }); }
                                db.SaveChanges(); await botClient.SendTextMessageAsync(message.Chat.Id, $"✅ Успішно додано {newTasks.Count} завдань!", cancellationToken: cancellationToken);
                            }
                        } catch (Exception ex) { await botClient.SendTextMessageAsync(message.Chat.Id, $"❌ Помилка: {ex.Message}", cancellationToken: cancellationToken); } return;
                    }
                }

                if (message.Text != null && message.Text.StartsWith("/broadcast") && AdminIds.Contains(message.Chat.Id)) {
                    string broadcastMessage = message.Text.Replace("/broadcast", "").Trim(); if (string.IsNullOrEmpty(broadcastMessage)) return;
                    var allUsers = GetUsers(); int successCount = 0;
                    foreach (var userId in allUsers) { try { await botClient.SendTextMessageAsync(userId, $"{broadcastMessage}", parseMode: ParseMode.Markdown, cancellationToken: cancellationToken); successCount++; } catch { } }
                    await botClient.SendTextMessageAsync(message.Chat.Id, $"✅ Розсилку завершено! Надіслано {successCount}.", cancellationToken: cancellationToken); return; 
                }

                if (message.Text == "/students" && AdminIds.Contains(message.Chat.Id)) {
                    using var db = new AppDbContext(); var allStudents = db.Students.ToList(); string responseText = $"👥 Всього: {allStudents.Count}\n\n";
                    foreach (var s in allStudents) responseText += $"👤 {s.FirstName}\n"; await botClient.SendTextMessageAsync(message.Chat.Id, responseText, cancellationToken: cancellationToken); return;
                }

                if (message.Text == "/progress" && AdminIds.Contains(message.Chat.Id)) {
                    using var db = new AppDbContext(); var students = db.Students.Where(s => s.FirstName != null && !s.FirstName.StartsWith("Гість")).ToList(); var allStudentTasks = db.StudentTasks.ToList(); string responseText = "📊 *Успішність групи:*\n\n";
                    var stats = students.Select(s => { var tasks = allStudentTasks.Where(t => t.StudentTelegramId == s.TelegramId).ToList(); int total = tasks.Count; int completed = tasks.Count(t => t.IsCompleted); int percent = total > 0 ? (int)Math.Round((double)completed / total * 100) : 0; return new { s.FirstName, Total = total, Completed = completed, Percent = percent }; }).OrderByDescending(x => x.Percent).ToList();
                    int place = 1; foreach (var stat in stats) { if (stat.Total == 0) continue; string medal = place switch { 1 => "🥇", 2 => "🥈", 3 => "🥉", _ => "👤" }; int greenCount = stat.Percent / 10; string bar = string.Concat(Enumerable.Repeat("🟩", greenCount)) + string.Concat(Enumerable.Repeat("⬜", 10 - greenCount)); responseText += $"{medal} *{stat.FirstName}*: {stat.Completed}/{stat.Total} ({stat.Percent}%)\n{bar}\n\n"; place++; }
                    await botClient.SendTextMessageAsync(message.Chat.Id, responseText, parseMode: ParseMode.Markdown, cancellationToken: cancellationToken); return;
                }

                if (message.Text == "/start") { await ShowMainMenu(botClient, message.Chat.Id, cancellationToken); return; }

                if (UserStates.TryGetValue(message.Chat.Id, out var state)) {
                    int targetTopic = state switch { "ukr" => TopicUkrId, "contact" => TopicContactId, "coursework" => TopicCourseworkId, "absence" => TopicAbsenceId, _ => 0 };
                    if (targetTopic != 0) {
                        if (message.MediaGroupId != null) {
                            if (!_mediaGroupCache.ContainsKey(message.MediaGroupId)) {
                                _mediaGroupCache[message.MediaGroupId] = new List<Message>();
                                _ = Task.Run(async () => {
                                    await Task.Delay(2000); if (!_mediaGroupCache.TryGetValue(message.MediaGroupId, out var cachedMessages)) return; _mediaGroupCache.Remove(message.MediaGroupId); var firstMsg = cachedMessages.First();
                                    string usernameStr = firstMsg.From?.Username != null ? "@" + firstMsg.From.Username : "відсутній"; string senderInfo = $"👤 **Від:** {firstMsg.From?.FirstName} {firstMsg.From?.LastName}\n🔗 **Юзернейм:** {usernameStr}\n🆔 `{firstMsg.From?.Id}`";
                                    if (state == "absence") senderInfo = "**ПОВІДОМЛЕННЯ ПРО ВІДСУТНІСТЬ** \n\n" + senderInfo; if (state == "coursework") senderInfo = "🎓 **КУРСОВА РОБОТА** \n\n" + senderInfo;
                                    await botClient.SendTextMessageAsync(GroupId, senderInfo, parseMode: ParseMode.Markdown, messageThreadId: targetTopic, cancellationToken: cancellationToken);
                                    foreach (var msg in cachedMessages) { var sentMsg = await botClient.CopyMessageAsync(GroupId, msg.Chat.Id, msg.MessageId, messageThreadId: targetTopic, cancellationToken: cancellationToken); MessageMap[sentMsg.Id] = msg.Chat.Id; }
                                    await botClient.SendTextMessageAsync(firstMsg.Chat.Id, $"✅ Надіслано {cachedMessages.Count} файлів!", cancellationToken: cancellationToken); UserStates.Remove(firstMsg.Chat.Id); await ShowMainMenu(botClient, firstMsg.Chat.Id, cancellationToken);
                                });
                            } _mediaGroupCache[message.MediaGroupId].Add(message); return; 
                        } else {
                            string usernameStr = message.From?.Username != null ? "@" + message.From.Username : "відсутній"; string senderInfo = $"👤 **Від:** {message.From?.FirstName} {message.From?.LastName}\n🔗 **Юзернейм:** {usernameStr}\n🆔 `{message.From?.Id}`";
                            if (state == "absence") senderInfo = "**ПОВІДОМЛЕННЯ ПРО ВІДСУТНІСТЬ** \n\n" + senderInfo; if (state == "coursework") senderInfo = "🎓 **КУРСОВА РОБОТА** \n\n" + senderInfo;
                            await botClient.SendTextMessageAsync(GroupId, senderInfo, parseMode: ParseMode.Markdown, messageThreadId: targetTopic, cancellationToken: cancellationToken);
                            var sentMsg = await botClient.CopyMessageAsync(GroupId, message.Chat.Id, message.MessageId, messageThreadId: targetTopic, cancellationToken: cancellationToken); MessageMap[sentMsg.Id] = message.Chat.Id;
                            await botClient.SendTextMessageAsync(message.Chat.Id, "✅ Надіслано!", cancellationToken: cancellationToken); UserStates.Remove(message.Chat.Id); await ShowMainMenu(botClient, message.Chat.Id, cancellationToken);
                        }
                    }
                } else await ShowMainMenu(botClient, message.Chat.Id, cancellationToken);
            }
            else if (message.Chat.Id == GroupId && message.ReplyToMessage != null) {
                if (MessageMap.TryGetValue(message.ReplyToMessage.MessageId, out var studentChatId)) { await botClient.CopyMessageAsync(studentChatId, message.Chat.Id, message.MessageId, cancellationToken: cancellationToken); }
            }
        }
    }

    static Task HandlePollingErrorAsync(ITelegramBotClient botClient, Exception exception, CancellationToken cancellationToken) { Console.WriteLine($"Помилка: {exception.Message}"); return Task.CompletedTask; }
}
