# Generated for local ticker contract-month selection.

from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0005_user_banknifty_expiry_user_finnifty_expiry_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="contract_month",
            field=models.CharField(
                choices=[
                    ("current", "Current"),
                    ("next", "Next"),
                    ("far", "Far"),
                ],
                default="current",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="sensex_expiry",
            field=models.DateField(default=django.utils.timezone.now),
        ),
    ]
