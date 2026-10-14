from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0008_smtpsettings_user_alert_email_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="smtpsettings",
            name="host",
            field=models.CharField(default="smtp.gmail.com", max_length=200),
        ),
        migrations.AlterField(
            model_name="smtpsettings",
            name="port",
            field=models.PositiveIntegerField(default=587),
        ),
    ]
