from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0007_alter_user_options_alter_user_username"),
    ]

    operations = [
        migrations.CreateModel(
            name="SMTPSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("enabled", models.BooleanField(default=False)),
                ("host", models.CharField(max_length=200)),
                ("port", models.PositiveIntegerField(default=587)),
                ("username", models.CharField(blank=True, default="", max_length=200)),
                ("password", models.CharField(blank=True, default="", max_length=200)),
                ("from_email", models.EmailField(blank=True, default="", max_length=254)),
                ("use_tls", models.BooleanField(default=True)),
                ("use_ssl", models.BooleanField(default=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "SMTP Setting",
                "verbose_name_plural": "SMTP Settings",
            },
        ),
        migrations.AddField(
            model_name="user",
            name="alert_email",
            field=models.EmailField(blank=True, default="", max_length=254),
        ),
        migrations.AddField(
            model_name="user",
            name="alert_lot_threshold",
            field=models.FloatField(default=0.0),
        ),
        migrations.AddField(
            model_name="user",
            name="alerts_enabled",
            field=models.BooleanField(default=False),
        ),
    ]
