from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0006_user_contract_month_user_sensex_expiry"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="user",
            options={"verbose_name": "App User", "verbose_name_plural": "App Users"},
        ),
        migrations.AlterField(
            model_name="user",
            name="username",
            field=models.CharField(max_length=50, unique=True),
        ),
    ]
